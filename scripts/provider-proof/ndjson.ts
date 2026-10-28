import { TextDecoder } from "node:util";
import { boundedJson, check, ProofError } from "./proof-errors.ts";

/** Codex stdio uses JSONL, without a jsonrpc header or Content-Length envelope. */
export class NdjsonReader {
    private chunks: Buffer[] = [];
    private size = 0;
    private failed = false;

    constructor(private readonly maxFrameBytes = 256 * 1024) {
        check(Number.isSafeInteger(maxFrameBytes) && maxFrameBytes > 0, "INVALID_FRAME_LIMIT");
    }

    push(chunk: Uint8Array, receive: (message: unknown) => void): void {
        check(!this.failed, "READER_CLOSED");
        try {
            const bytes = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
            let offset = 0;
            while (offset < bytes.length) {
                const newline = bytes.indexOf(10, offset);
                const end = newline < 0 ? bytes.length : newline;
                const part = bytes.subarray(offset, end);
                check(this.size + part.length <= this.maxFrameBytes, "FRAME_TOO_LARGE");
                // Copy only the bounded frame, never retain an arbitrary transport chunk.
                if (part.length) this.chunks.push(Buffer.from(part));
                this.size += part.length;
                if (newline < 0) break;
                const frame = Buffer.concat(this.chunks, this.size);
                this.chunks = [];
                this.size = 0;
                check(frame.length > 0, "EMPTY_FRAME");
                let value: unknown;
                try {
                    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(frame));
                } catch {
                    throw new ProofError("INVALID_JSON_FRAME");
                }
                check(value !== null && typeof value === "object" && !Array.isArray(value), "INVALID_ENVELOPE");
                receive(value);
                offset = newline + 1;
            }
        } catch (error) {
            this.close();
            throw error;
        }
    }

    end(): void {
        check(!this.failed, "READER_CLOSED");
        const truncated = this.size !== 0;
        this.close();
        check(!truncated, "TRUNCATED_FRAME");
    }

    close(): void {
        this.failed = true;
        this.chunks = [];
        this.size = 0;
    }
}

export function encodeFrame(message: unknown, maxFrameBytes = 256 * 1024): Buffer {
    return Buffer.from(`${boundedJson(message, maxFrameBytes)}\n`, "utf8");
}
