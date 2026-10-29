export type CoreRequest = (method: string, args?: Record<string, unknown>) => Promise<Record<string, unknown>>;
const LIMIT = 1024 * 1024;
const CHUNK = 16 * 1024;
const encoder = new TextEncoder();

function integer(value: unknown): number {
    if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error("Invalid preferences response.");
    return value as number;
}
function decode(value: unknown): Uint8Array {
    if (typeof value !== "string" || value.length > CHUNK * 2) throw new Error("Invalid preferences data.");
    return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}
function encode(bytes: Uint8Array): string { return btoa(String.fromCharCode(...bytes)); }

/** A revision is learned only from a complete read or confirmed SQLite commit. */
export class CorePreferencesStore {
    private revision?: number;
    constructor(private request: CoreRequest) {}

    async load(): Promise<unknown | null> {
        let offset = 0, revision: number | undefined, bytes: Uint8Array | undefined;
        while (true) {
            const frame = await this.request("preferences.load", { offset });
            const nextRevision = integer(frame.revision), total = integer(frame.total_bytes);
            if (total > LIMIT || integer(frame.offset) !== offset || (revision !== undefined && revision !== nextRevision))
                throw new Error("Preferences changed while loading. Original data was preserved.");
            revision = nextRevision;
            bytes ??= new Uint8Array(total);
            if (bytes.length !== total) throw new Error("Preferences size changed while loading.");
            const chunk = decode(frame.data);
            if (chunk.length > CHUNK || offset + chunk.length > total || (!chunk.length && frame.eof !== true))
                throw new Error("Incomplete preferences data.");
            bytes.set(chunk, offset); offset += chunk.length;
            if (frame.eof === true) {
                if (offset !== total || (revision === 0 && total !== 0) || (revision !== 0 && total === 0))
                    throw new Error("Incomplete preferences data.");
                const value = total ? JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) : null;
                this.revision = revision;
                return value;
            }
        }
    }

    async save(value: unknown): Promise<void> {
        if (this.revision === undefined) throw new Error("A fresh preferences read is required before saving; previous completion is unknown.");
        const json = JSON.stringify(value);
        if (typeof json !== "string") throw new Error("Preferences must be JSON.");
        const bytes = encoder.encode(json);
        if (!bytes.length || bytes.length > LIMIT) throw new Error("Preferences exceed 1 MiB.");
        const upload = crypto.randomUUID();
        try {
            const started = await this.request("preferences.save.begin", { upload_id: upload, total_bytes: bytes.length, expected_revision: this.revision });
            if (started.upload_id !== upload) throw new Error("Invalid preferences upload.");
            for (let offset = 0; offset < bytes.length; offset += CHUNK) {
                const end = Math.min(offset + CHUNK, bytes.length);
                const result = await this.request("preferences.save.chunk", { upload_id: upload, offset, data: encode(bytes.subarray(offset, end)) });
                if (integer(result.received_bytes) !== end) throw new Error("Incomplete preferences upload.");
            }
            const result = await this.request("preferences.save.commit", { upload_id: upload });
            const revision = integer(result.revision);
            if (revision !== this.revision + 1) throw new Error("Unconfirmed preferences revision.");
            this.revision = revision;
        } catch (error) {
            // A timeout can mean COMMIT succeeded. Require a fresh read before
            // another mutation instead of retrying an uncertain operation.
            this.revision = undefined;
            await this.request("preferences.save.cancel", { upload_id: upload }).catch(() => {});
            throw error;
        }
    }
}
