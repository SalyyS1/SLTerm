export class ProofError extends Error {
    constructor(readonly code: string) {
        // Error messages deliberately exclude provider payloads and credentials.
        super(code);
        this.name = "ProofError";
    }
}

export function check(condition: unknown, code: string): asserts condition {
    if (!condition) throw new ProofError(code);
}

export function boundedJson(value: unknown, maxBytes = 256 * 1024): string {
    let json: string | undefined;
    try { json = JSON.stringify(value); }
    catch { throw new ProofError("INVALID_JSON_VALUE"); }
    check(typeof json === "string", "INVALID_JSON_VALUE");
    check(Buffer.byteLength(json) <= maxBytes, "FRAME_TOO_LARGE");
    return json;
}

export function requestKey(id: unknown): string {
    check(
        (typeof id === "string" && id.length > 0 && id.length <= 256) ||
            (typeof id === "number" && Number.isSafeInteger(id)),
        "INVALID_REQUEST_ID"
    );
    return `${typeof id}:${id}`;
}
