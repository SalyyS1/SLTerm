import { describe, expect, it } from "vitest";
import { CorePreferencesStore, type CoreRequest } from "./core-preferences-store";

describe("core preferences transport", () => {
    it("reassembles Unicode documents across byte chunks and rejects changing revisions", async () => {
        const value = { name: "Tiếng Việt🙂".repeat(3000) };
        const bytes = new TextEncoder().encode(JSON.stringify(value));
        let drift = false;
        const request: CoreRequest = async (_method, args = {}) => {
            const offset = args.offset as number;
            const chunk = bytes.subarray(offset, offset + 16384);
            return { offset, data: btoa(String.fromCharCode(...chunk)), revision: drift && offset ? 2 : 1, total_bytes: bytes.length, eof: offset + chunk.length === bytes.length };
        };
        const store = new CorePreferencesStore(request);
        await expect(store.load()).resolves.toEqual(value);
        drift = true;
        await expect(store.load()).rejects.toThrow("changed while loading");
    });

    it("cancels a client-known stage after losing begin acknowledgement and requires a fresh read", async () => {
        let upload: unknown, cancelled: unknown;
        const store = new CorePreferencesStore(async (method, args = {}) => {
            if (method === "preferences.load") return { offset: 0, data: "", total_bytes: 0, eof: true, revision: 0 };
            if (method === "preferences.save.begin") { upload = args.upload_id; throw new Error("Timed out; completion is unknown"); }
            if (method === "preferences.save.cancel") { cancelled = args.upload_id; return { cancelled: true }; }
            throw new Error("Unexpected " + method);
        });
        await store.load();
        await expect(store.save({ version: 1 })).rejects.toThrow("completion is unknown");
        expect(typeof upload).toBe("string"); expect(cancelled).toBe(upload);
        await expect(store.save({ version: 1 })).rejects.toThrow("fresh");
        await store.load();
        await expect(store.save({ version: 1 })).rejects.toThrow("completion is unknown");
    });

    it("does not claim a successful save when COMMIT acknowledgement is missing", async () => {
        const original = { version: 1, name: "committed" };
        let saved = false, upload: unknown;
        const store = new CorePreferencesStore(async (method, args = {}) => {
            if (method === "preferences.load") {
                const text = saved ? JSON.stringify(original) : "";
                return { offset: 0, data: btoa(text), total_bytes: text.length, eof: true, revision: saved ? 1 : 0 };
            }
            if (method === "preferences.save.begin") { upload = args.upload_id; return { upload_id: upload }; }
            if (method === "preferences.save.chunk") return { received_bytes: JSON.stringify(original).length };
            if (method === "preferences.save.commit") { saved = true; throw new Error("pipe closed"); }
            return { cancelled: false };
        });
        await store.load();
        await expect(store.save(original)).rejects.toThrow("pipe closed");
        await expect(store.save(original)).rejects.toThrow("fresh");
        await expect(store.load()).resolves.toEqual(original);
    });
});
