import { splitInput } from "./proof-protocol";

/** Counts queued and in-flight bytes together; uncertain delivery is never replayed. */
export class TerminalInput {
    private chunks: string[] = [];
    private bytes = 0;
    private sending = false;
    private paused = true;
    private closed = false;

    constructor(
        private send: (data: string) => Promise<void>,
        private fail: (error: unknown, uncertain: boolean) => void
    ) {}

    enqueue(data: string) {
        if (this.closed) return;
        try {
            const input = splitInput(data);
            if (this.bytes + input.bytes > 65536) throw new Error("Bộ đệm nhập đầy; phần nhập mới chưa được nhận.");
            this.bytes += input.bytes;
            this.chunks.push(...input.chunks);
            void this.drain();
        } catch (error) {
            this.fail(error, false);
        }
    }

    resume() {
        this.paused = false;
        void this.drain();
    }
    stop() {
        this.closed = true;
        this.chunks = [];
    }

    private async drain() {
        if (this.sending || this.paused || this.closed) return;
        this.sending = true;
        try {
            while (this.chunks.length && !this.closed) {
                const data = this.chunks.shift()!;
                await this.send(data);
                this.bytes -= new TextEncoder().encode(data).length;
            }
        } catch (error) {
            this.closed = true;
            this.fail(error, true);
        } finally {
            this.sending = false;
            if (this.closed) {
                this.chunks = [];
                this.bytes = 0;
            }
        }
    }
}
