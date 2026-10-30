export const TRANSCRIPT_MAX_BYTES = 8 * 1024 * 1024;
export const TRANSCRIPT_CHUNK_BYTES = 16 * 1024;

export type TranscriptRequest = (method: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>;
export type TranscriptMetadata = {
    identity_json: string; stream_error: string | null; created_unix_ms: number; finished: boolean;
    process_eof: boolean; capture_complete: boolean; truncated: boolean; recorded_bytes: number;
    omitted_bytes: number; discarded_bytes: number; last_sequence: number; recorded_sequence: number;
    exit_code: number | null;
};
export type TranscriptChunk = { data: string; offset: number; next_offset: number; sequence: number; chunk_offset: number; eof: boolean };

const integer = (value: unknown, name: string) => {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid transcript ${name}.`);
    return value;
};
const uuid = (value: unknown) => {
    if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) throw new Error("Invalid transcript run ID.");
    return value;
};
const decode = (value: unknown) => {
    if (typeof value !== "string" || value.length > Math.ceil(TRANSCRIPT_CHUNK_BYTES / 3) * 4) throw new Error("Invalid transcript chunk.");
    const bytes = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
    if (bytes.length > TRANSCRIPT_CHUNK_BYTES) throw new Error("Transcript chunk exceeds 16 KiB.");
    return bytes;
};

export function validateTranscriptMetadata(value: Record<string, unknown>, expectedRunId?: string): TranscriptMetadata {
    if (typeof value.identity_json !== "string" || new TextEncoder().encode(value.identity_json).length > 8 * 1024) throw new Error("Invalid transcript identity.");
    try {
        const identity = JSON.parse(value.identity_json) as Record<string, unknown>;
        if (!identity || identity.version !== 1 || identity.protocol_version !== 1 || identity.execution_host !== "windows-local" || typeof identity.cwd !== "string" && identity.cwd !== null || !["shell", "claude", "codex"].includes(String(identity.provider)) || typeof identity.attempt_id !== "string") throw new Error();
        uuid(identity.attempt_id);
        if (identity.task_id != null) {
            uuid(identity.task_id);
            if (identity.provider === "shell" || typeof identity.cwd !== "string" || identity.worktree !== identity.cwd) throw new Error();
        } else if (identity.worktree != null) throw new Error();
        if (expectedRunId && identity.attempt_id !== expectedRunId) throw new Error();
    } catch { throw new Error("Invalid transcript identity."); }
    for (const key of ["finished", "process_eof", "capture_complete", "truncated"])
        if (typeof value[key] !== "boolean") throw new Error("Invalid transcript completion flags.");
    if (value.stream_error !== null && (typeof value.stream_error !== "string" || !value.stream_error.length || new TextEncoder().encode(value.stream_error).length > 1024))
        throw new Error("Invalid transcript error.");
    const metadata = {
        identity_json: value.identity_json, stream_error: value.stream_error == null ? null : String(value.stream_error),
        created_unix_ms: integer(value.created_unix_ms, "creation time"), finished: value.finished === true,
        process_eof: value.process_eof === true, capture_complete: value.capture_complete === true,
        truncated: value.truncated === true, recorded_bytes: integer(value.recorded_bytes, "recorded bytes"),
        omitted_bytes: integer(value.omitted_bytes, "omitted bytes"), discarded_bytes: integer(value.discarded_bytes, "discarded bytes"),
        last_sequence: integer(value.last_sequence, "last sequence"), recorded_sequence: integer(value.recorded_sequence, "recorded sequence"),
        exit_code: value.exit_code == null ? null : integer(value.exit_code, "exit code"),
    };
    if (metadata.recorded_bytes > TRANSCRIPT_MAX_BYTES || metadata.recorded_sequence > metadata.last_sequence ||
        (metadata.recorded_bytes === 0) !== (metadata.recorded_sequence === 0) ||
        metadata.exit_code !== null && metadata.exit_code > 0xffffffff) throw new Error("Invalid transcript bounds.");
    const complete = metadata.finished && metadata.process_eof && !metadata.truncated && metadata.omitted_bytes === 0 && metadata.stream_error === null;
    if (metadata.finished !== (metadata.exit_code !== null) || metadata.capture_complete !== complete ||
        metadata.process_eof && (!metadata.finished || metadata.stream_error !== null)) throw new Error("Invalid transcript completion state.");
    return metadata;
}

export async function replayTranscript(request: TranscriptRequest, runId: string | undefined, write: (bytes: Uint8Array) => Promise<void>, cancelled = () => false): Promise<TranscriptMetadata> {
    if (!runId) throw new Error("Không có transcript đã lưu cho phiên terminal này.");
    uuid(runId);
    const metadata = validateTranscriptMetadata(await request("transcripts.metadata", { run_id: runId }), runId);
    if (cancelled()) throw new Error("Transcript replay cancelled.");
    let offset = 0;
    let sequence = 0;
    while (true) {
        if (cancelled()) throw new Error("Transcript replay cancelled.");
        const result = await request("transcripts.read", { run_id: runId, offset });
        if (cancelled()) throw new Error("Transcript replay cancelled.");
        const chunk = decode(result.data);
        if (integer(result.offset, "offset") !== offset || integer(result.next_offset, "next offset") !== offset + chunk.length ||
            integer(result.sequence, "sequence") !== sequence + (chunk.length ? 1 : 0) || integer(result.chunk_offset, "chunk offset") !== 0 ||
            offset + chunk.length > metadata.recorded_bytes || (!chunk.length && result.eof !== true))
            throw new Error("Transcript chunk sequence or offset is invalid.");
        if (result.eof !== (result.next_offset === metadata.recorded_bytes)) throw new Error("Transcript EOF is invalid.");
        if (chunk.length) { sequence = integer(result.sequence, "sequence"); await write(chunk); }
        if (cancelled()) throw new Error("Transcript replay cancelled.");
        offset = integer(result.next_offset, "next offset");
        if (result.eof === true) break;
    }
    if (offset !== metadata.recorded_bytes || sequence !== metadata.recorded_sequence) throw new Error("Transcript replay is incomplete.");
    return metadata;
}
