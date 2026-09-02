// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

/** The slice of xterm's Terminal a writer needs, so tests need no real one. */
type WritableTerminal = {
    write(data: string | Uint8Array): void;
};

/**
 * Coalesces terminal output writes at 16ms (one frame) intervals to cut render
 * calls under high throughput.
 *
 * Only OUTPUT goes through here — input is never batched, because the screen is
 * painted solely by the PTY's echo coming back and batching it would risk
 * doubling keystrokes.
 */
export class BatchedWriter {
    private buffer: (string | Uint8Array)[] = [];
    private timer: ReturnType<typeof setTimeout> | null = null;
    private readonly BATCH_DELAY_MS = 16;
    private readonly MAX_BATCH_SIZE = 100;

    constructor(private terminal: WritableTerminal) {}

    write(data: string | Uint8Array): void {
        this.buffer.push(data);
        if (this.buffer.length >= this.MAX_BATCH_SIZE) {
            this.flush();
        } else if (!this.timer) {
            this.timer = setTimeout(() => this.flush(), this.BATCH_DELAY_MS);
        }
    }

    flush(): void {
        if (this.buffer.length > 0) {
            const chunks = this.buffer;
            this.buffer = [];
            // Bytes stay bytes. Decoding them here would corrupt any UTF-8
            // character or escape sequence that straddles a chunk boundary,
            // because a decoder created per flush cannot carry the partial
            // sequence across flushes — and xterm's parser already carries
            // exactly that state across writes. A half-parsed escape sequence is
            // what turns an in-place redraw into stacked duplicate lines.
            // Adjacent byte chunks are still concatenated so a batch costs one
            // write.
            let pending: Uint8Array[] = [];
            let pendingLen = 0;
            const writePending = () => {
                if (pendingLen === 0) {
                    return;
                }
                if (pending.length === 1) {
                    this.terminal.write(pending[0]);
                } else {
                    const merged = new Uint8Array(pendingLen);
                    let at = 0;
                    for (const chunk of pending) {
                        merged.set(chunk, at);
                        at += chunk.length;
                    }
                    this.terminal.write(merged);
                }
                pending = [];
                pendingLen = 0;
            };
            for (const chunk of chunks) {
                if (typeof chunk === "string") {
                    writePending();
                    this.terminal.write(chunk);
                } else {
                    pending.push(chunk);
                    pendingLen += chunk.length;
                }
            }
            writePending();
        }
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }

    dispose(): void {
        this.flush();
    }
}
