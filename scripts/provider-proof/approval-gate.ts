import { createHash, randomUUID } from "node:crypto";
import { boundedJson, check, requestKey } from "./proof-errors.ts";

export type Approval = Readonly<{ token: string; requestId: string | number; actionJson: string }>;
type Entry = { approval: Approval; deadline: number; expire: () => void; timer: NodeJS.Timeout };

/** Application state: tokens bind an immutable exact action to one provider turn. */
export class ApprovalGate {
    private entries = new Map<string, Entry>();
    private seen = new Set<string>();
    private turn: { threadId: string; turnId: string; nonce: string } | undefined;

    constructor(private readonly ttlMs = 30_000, private readonly now = Date.now) {
        check(Number.isSafeInteger(ttlMs) && ttlMs > 0 && ttlMs <= 300_000, "INVALID_APPROVAL_TTL");
    }

    begin(threadId: string, turnId: string): void {
        check(!this.turn, "TURN_ALREADY_ACTIVE");
        check(threadId.length > 0 && turnId.length > 0, "INVALID_TURN_ID");
        this.seen.clear();
        this.turn = { threadId, turnId, nonce: randomUUID() };
    }

    matches(threadId: string, turnId: string): boolean {
        return this.turn?.threadId === threadId && this.turn.turnId === turnId;
    }

    offer(requestId: string | number, payload: unknown, expire = () => {}): Approval {
        check(this.turn, "NO_ACTIVE_TURN");
        const key = requestKey(requestId);
        check(!this.seen.has(key), "DUPLICATE_APPROVAL_ID");
        check(this.seen.size < 4096, "APPROVAL_LEDGER_FULL");
        check(this.entries.size < 64, "APPROVAL_BACKPRESSURE");
        const snapshot = boundedJson(payload);
        const token = createHash("sha256").update(boundedJson({ ...this.turn, key, snapshot })).digest("hex");
        const approval = Object.freeze({ token, requestId, actionJson: snapshot });
        const timer = setTimeout(() => this.revoke(requestId), this.ttlMs);
        timer.unref();
        this.entries.set(key, { approval, deadline: this.now() + this.ttlMs, expire, timer });
        this.seen.add(key);
        return approval;
    }

    consume(requestId: string | number, token: string): Approval {
        const key = requestKey(requestId);
        const entry = this.entries.get(key);
        check(entry && this.turn, "STALE_APPROVAL");
        if (this.now() >= entry.deadline) {
            this.revoke(requestId);
            check(false, "EXPIRED_APPROVAL");
        }
        check(entry.approval.token === token, "APPROVAL_ACTION_MISMATCH");
        this.entries.delete(key);
        clearTimeout(entry.timer);
        return entry.approval;
    }

    revoke(requestId: string | number, notify = true): void {
        const key = requestKey(requestId);
        const entry = this.entries.get(key);
        if (!entry) return;
        this.entries.delete(key);
        clearTimeout(entry.timer);
        if (notify) entry.expire();
    }

    finish(notify = true): void {
        this.turn = undefined;
        for (const entry of [...this.entries.values()]) this.revoke(entry.approval.requestId, notify);
    }
}
