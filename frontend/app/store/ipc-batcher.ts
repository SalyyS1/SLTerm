// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

// IPCBatcher coalesces fire-and-forget RPC status updates within a 16ms window.
// Latest value per channel wins (idempotent coalesce). Critical calls bypass batching.
// Use this for noresponse status updates (block status, activity, RT info).
// DO NOT use for: terminal data, auth, input, or any call that needs a response.

import { WshClient } from "./wshclient";

type BatchEntry = {
    command: string;
    data: unknown;
};

class IPCBatcher {
    private batch: Map<string, BatchEntry> = new Map();
    private timer: ReturnType<typeof setTimeout> | null = null;
    private client: WshClient | null = null;
    private readonly BATCH_INTERVAL_MS = 16;

    /** Attach a WshClient. Call once during app initialization. */
    setClient(client: WshClient): void {
        this.client = client;
    }

    /**
     * Queue a fire-and-forget RPC call. Latest value per key wins.
     * @param key     Dedup key (e.g. command name or "command:id").
     * @param command RPC command string.
     * @param data    Payload — must be idempotent (last write wins is safe).
     * @param critical If true, sends immediately bypassing the batch window.
     */
    send(key: string, command: string, data: unknown, critical = false): void {
        if (!this.client) {
            return;
        }
        if (critical) {
            this.client.wshRpcCall(command, data, { noresponse: true });
            return;
        }
        this.batch.set(key, { command, data });
        if (!this.timer) {
            this.timer = setTimeout(() => this.flush(), this.BATCH_INTERVAL_MS);
        }
    }

    /** Flush all pending entries immediately. */
    flush(): void {
        if (!this.client) {
            this.batch.clear();
            this.timer = null;
            return;
        }
        for (const entry of this.batch.values()) {
            this.client.wshRpcCall(entry.command, entry.data, { noresponse: true });
        }
        this.batch.clear();
        this.timer = null;
    }

    /** Flush and release resources. */
    dispose(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        this.flush();
    }
}

export const ipcBatcher = new IPCBatcher();
