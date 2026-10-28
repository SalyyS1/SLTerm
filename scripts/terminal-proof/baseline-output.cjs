/* Serialized into the disposable baseline renderer; keep this function self-contained. */
async function readPtyOutput(endpoint, blockId, authKey, timeoutMs = 5000, maxBytes = 1024 * 1024) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("PTY output read timed out")), timeoutMs);
    let reader;
    try {
        const query = new URLSearchParams({ zoneid: blockId, name: "term", offset: "0" });
        const response = await fetch(`${endpoint}/wave/file?${query}`, {
            headers: { "X-AuthKey": authKey }, signal: controller.signal,
        });
        if (!response.ok) throw new Error(`PTY read HTTP ${response.status}`);
        if (!response.body) throw new Error("PTY read has no response body");
        reader = response.body.getReader();
        const decoder = new TextDecoder();
        let output = "", bytes = 0;
        while (true) {
            const { value, done } = await reader.read();
            if (done) return output + decoder.decode();
            bytes += value.byteLength;
            if (bytes > maxBytes) {
                controller.abort();
                throw new Error("PTY output exceeds probe byte limit");
            }
            output += decoder.decode(value, { stream: true });
        }
    } finally {
        clearTimeout(timer);
        // Non-2xx responses may leave a body streaming even without a reader.
        controller.abort();
        reader?.releaseLock();
    }
}

// A clean application exit alone is insufficient evidence of the requested workload.
function baselineOutcome(code, signal, requested, workload) {
    const terminals = workload?.terminals ?? [];
    const workloadPassed = requested === 0 || (
        workload?.status === "ready" && workload.requested === requested &&
        workload.shellIdentitiesVerified === true && workload.renderedXtermCount >= requested &&
        terminals.length === requested && new Set(terminals.map((item) => item.shellPid)).size === requested &&
        terminals.every((item) => item.outputVerified && item.historyAndUtf8Verified && item.startupReceiptMatched)
    );
    return {
        applicationExitCode: code, signal, requestedTerminals: requested, workloadPassed,
        workloadStatus: workload?.status ?? (requested ? "missing" : "not-requested"),
        harnessExitCode: code === 0 && signal === null && workloadPassed ? 0 : (code || 1),
    };
}

// ConPTY inserts cursor controls and physical line breaks when a pane is narrow.
// Keep printable input (including quotes/operators) so echoed source cannot become
// a framed output receipt. Every accepted PID is also checked against startup.
function compactPtyOutput(output) {
    return output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/[\r\n]/g, "");
}

module.exports = { readPtyOutput, baselineOutcome, compactPtyOutput };
