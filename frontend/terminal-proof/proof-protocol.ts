export type Frame = {
    version?: number;
    id?: number;
    ok?: boolean;
    error_code?: string;
    event?: string;
    session_id?: number;
    data?: string;
    sequence?: number;
    exit_code?: number;
    discarded_bytes?: number;
    affected_bytes?: number;
    last_sequence?: number;
    message?: string;
};

type Waiter = { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
type Send = (request: Record<string, unknown>) => Promise<void>;

export class ProofTransport {
    private pending = new Map<number, Waiter>();
    private nextId = 1;
    private closed = false;

    constructor(private send: Send) {}

    request(method: string, args: Record<string, unknown> = {}): Promise<void> {
        if (this.closed) return Promise.reject(new Error("Core transport is closed"));
        if (this.pending.size >= 64)
            return Promise.reject(new Error("Too many pending requests; input was not accepted"));
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`Timed out: ${method}; completion is unknown`));
            }, 15000);
            this.pending.set(id, { resolve, reject, timer });
            this.send({ ...args, version: 1, id, method }).catch((error) => {
                const waiter = this.pending.get(id);
                if (!waiter) return;
                clearTimeout(timer);
                this.pending.delete(id);
                reject(new Error(String(error)));
            });
        });
    }

    receive(frame: Frame): boolean {
        if (frame.id === undefined) return false;
        if (frame.id === 0) throw new Error(frame.error_code ?? "Core rejected an uncorrelated request");
        const waiter = this.pending.get(frame.id);
        if (waiter) {
            clearTimeout(waiter.timer);
            this.pending.delete(frame.id);
            frame.ok === true
                ? waiter.resolve()
                : waiter.reject(new Error(frame.error_code ?? "Invalid core response"));
        }
        return true;
    }

    close(message = "Core exited before the request completed") {
        this.closed = true;
        for (const waiter of this.pending.values()) {
            clearTimeout(waiter.timer);
            waiter.reject(new Error(message));
        }
        this.pending.clear();
    }
}

// Split only at UTF-8 code-point boundaries; Zig accepts at most 4096 input bytes.
export function splitInput(data: string): { chunks: string[]; bytes: number } {
    if (data.length > 65536) throw new Error("Paste exceeds the 64 KiB proof input buffer; input was not accepted");
    const bytes = new TextEncoder().encode(data);
    if (bytes.length > 65536) throw new Error("Paste exceeds the 64 KiB proof input buffer; input was not accepted");
    const chunks: string[] = [];
    const decoder = new TextDecoder("utf-8", { fatal: true });
    for (let start = 0; start < bytes.length; ) {
        let end = Math.min(start + 4096, bytes.length);
        while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
        chunks.push(decoder.decode(bytes.subarray(start, end)));
        start = end;
    }
    return { chunks, bytes: bytes.length };
}

export class OutputOrder {
    private received = 0;
    private ended = false;

    next(sequence: number | undefined) {
        if (this.ended || sequence !== this.received + 1) throw new Error("Out-of-order terminal output");
        this.received = sequence;
    }

    finish(lastSequence: number | undefined) {
        if (this.ended || lastSequence !== this.received) throw new Error("Terminal exit did not follow all output");
        this.ended = true;
    }
}
