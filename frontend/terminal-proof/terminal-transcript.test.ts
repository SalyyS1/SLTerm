import { describe, expect, it, vi } from "vitest";
import { replayTranscript, validateTranscriptMetadata } from "./terminal-transcript";

const id = "123e4567-e89b-12d3-a456-426614174000";
const b64 = (value: Uint8Array | string) => btoa(typeof value === "string" ? value : String.fromCharCode(...value));
const metadata = (patch: Record<string, unknown> = {}) => ({ identity_json: JSON.stringify({ version: 1, protocol_version: 1, execution_host: "windows-local", cwd: "C:/work", provider: "shell", attempt_id: id }), stream_error: null, created_unix_ms: 1, finished: true, process_eof: true, capture_complete: true, truncated: false, recorded_bytes: 7, omitted_bytes: 0, discarded_bytes: 0, last_sequence: 2, recorded_sequence: 2, exit_code: 0, ...patch });

describe("transcript replay", () => {
    it("writes split UTF-8 chunks in exact callback order", async () => {
        const bytes = new TextEncoder().encode("hé🙂"), writes: Uint8Array[] = [];
        let resume!: () => void, started!: () => void;
        const firstWrite = new Promise<void>((resolve) => { started = resolve; });
        const request = vi.fn(async (method: string, args: Record<string, unknown>) => method === "transcripts.metadata" ? metadata() : ({
            data: b64(args.offset === 0 ? bytes.subarray(0, 2) : bytes.subarray(2)), offset: args.offset,
            next_offset: args.offset === 0 ? 2 : 7, sequence: args.offset === 0 ? 1 : 2, chunk_offset: 0, eof: args.offset === 2,
        }));
        const replay = replayTranscript(request, id, async (part) => {
            writes.push(part);
            if (writes.length === 1) { started(); await new Promise<void>((resolve) => { resume = resolve; }); }
        });
        await firstWrite;
        expect(request.mock.calls.filter(([method]) => method === "transcripts.read")).toHaveLength(1);
        resume(); await replay;
        expect([...writes[0], ...writes[1]]).toEqual([...bytes]);
    });
    it("rejects malformed identity, offsets and sequences", async () => {
        await expect(replayTranscript(async (method) => method === "transcripts.metadata" ? metadata({ identity_json: "{" }) : {}, id, async () => {})).rejects.toThrow("Invalid transcript identity");
        await expect(replayTranscript(async (method) => method === "transcripts.metadata" ? metadata() : ({ data: b64("x"), offset: 1, next_offset: 2, sequence: 1, chunk_offset: 0, eof: false }), id, async () => {})).rejects.toThrow("offset");
    });
    it("reports missing IDs and cancellation without reading", async () => {
        let reads = 0;
        await expect(replayTranscript(async (method) => { if (method === "transcripts.read") reads++; return metadata(); }, undefined, async () => {})).rejects.toThrow("Không có transcript");
        await expect(replayTranscript(async () => metadata(), id, async () => {}, () => true)).rejects.toThrow("cancelled");
        expect(reads).toBe(0);
    });
    it("allows explicit interrupted and truncated metadata to reach the caller", async () => {
        const interrupted = await replayTranscript(async (method) => method === "transcripts.metadata" ? metadata({ finished: false, process_eof: false, exit_code: null, capture_complete: false, recorded_bytes: 0, recorded_sequence: 0, last_sequence: 1 }) : ({ data: "", offset: 0, next_offset: 0, sequence: 0, chunk_offset: 0, eof: true }), id, async () => {});
        expect(interrupted?.finished).toBe(false);
        const truncated = await replayTranscript(async (method) => method === "transcripts.metadata" ? metadata({ truncated: true, capture_complete: false, omitted_bytes: 100, recorded_bytes: 5, recorded_sequence: 1, last_sequence: 2 }) : ({ data: b64("12345"), offset: 0, next_offset: 5, sequence: 1, chunk_offset: 0, eof: true }), id, async () => {});
        expect(truncated?.truncated).toBe(true);
    });
    it("rejects inconsistent metadata and a different immutable run identity", () => {
        expect(() => validateTranscriptMetadata(metadata(), "123e4567-e89b-42d3-b456-426614174000")).toThrow("identity");
        for (const patch of [{ finished: "true" }, { process_eof: false }, { stream_error: 7 }, { finished: false },
            { recorded_bytes: 8 * 1024 * 1024 + 1 }, { recorded_sequence: 3 }])
            expect(() => validateTranscriptMetadata(metadata(patch))).toThrow("transcript");
    });
    it("rejects skipped sequences and no progress before rendering", async () => {
        for (const patch of [{ sequence: 2 }, { next_offset: 9 }, { chunk_offset: 1 }, { data: "", next_offset: 0 }]) {
            const write = vi.fn(async () => {});
            await expect(replayTranscript(async (method) => method === "transcripts.metadata" ? metadata()
                : { data: b64("hi"), offset: 0, next_offset: 2, sequence: 1, chunk_offset: 0, eof: false, ...patch }, id, write)).rejects.toThrow("Transcript");
            expect(write).not.toHaveBeenCalled();
        }
    });
    it("cancels a pending read before writing and validates canonical IDs before RPC", async () => {
        let cancelled = false, resume!: (value: Record<string, unknown>) => void, started!: () => void;
        const pendingRead = new Promise<void>((resolve) => { started = resolve; });
        const request = vi.fn(async (method: string) => method === "transcripts.metadata" ? metadata()
            : new Promise<Record<string, unknown>>((resolve) => { resume = resolve; started(); }));
        const write = vi.fn(async () => {}), replay = replayTranscript(request, id, write, () => cancelled);
        await pendingRead; cancelled = true;
        resume({ data: b64("hello!!"), offset: 0, next_offset: 7, sequence: 1, chunk_offset: 0, eof: true });
        await expect(replay).rejects.toThrow("cancelled"); expect(write).not.toHaveBeenCalled();
        request.mockClear();
        for (const invalid of [undefined, id.toUpperCase(), "../not-a-run"])
            await expect(replayTranscript(request, invalid, write)).rejects.toThrow();
        expect(request).not.toHaveBeenCalled();
    });
});
