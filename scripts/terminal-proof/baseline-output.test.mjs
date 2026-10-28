import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import helpers from "./baseline-output.cjs";

const { readPtyOutput, baselineOutcome, compactPtyOutput } = helpers;

async function withServer(handler, check) {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try { await check(`http://127.0.0.1:${server.address().port}`); }
    finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
}

test("PTY deadline covers a server that never sends headers", async () => {
    await withServer(() => {}, async (endpoint) => {
        await assert.rejects(readPtyOutput(endpoint, "block", "fixture-key", 100), /timed out/);
    });
});

test("PTY deadline covers a server that starts but never finishes its body", async () => {
    await withServer((_request, response) => { response.writeHead(200); response.write("partial"); }, async (endpoint) => {
        await assert.rejects(readPtyOutput(endpoint, "block", "fixture-key", 100), /timed out|aborted/i);
    });
});

test("PTY read keeps auth in the header and decodes split Vietnamese UTF-8", async () => {
    const text = "B0:123:E — tiếng Việt";
    await withServer((request, response) => {
        assert.equal(request.headers["x-authkey"], "fixture-key");
        assert.equal(request.url, "/wave/file?zoneid=block&name=term&offset=0");
        const bytes = Buffer.from(text);
        response.write(bytes.subarray(0, 13));
        setImmediate(() => response.end(bytes.subarray(13)));
    }, async (endpoint) => assert.equal(await readPtyOutput(endpoint, "block", "fixture-key"), text));
});

test("PTY read rejects HTTP errors and oversized output", async () => {
    await withServer((_request, response) => { response.writeHead(403); response.end(); }, async (endpoint) => {
        await assert.rejects(readPtyOutput(endpoint, "block", "fixture-key"), /HTTP 403/);
    });
    await withServer((_request, response) => response.end("12345"), async (endpoint) => {
        await assert.rejects(readPtyOutput(endpoint, "block", "fixture-key", 1000, 4), /byte limit/);
    });
});

test("non-2xx response cancels an unfinished body before retry", async () => {
    let bodyClosed;
    await withServer((_request, response) => {
        bodyClosed = once(response, "close", { signal: AbortSignal.timeout(1500) });
        response.writeHead(403); response.write("unfinished");
    }, async (endpoint) => {
        await assert.rejects(readPtyOutput(endpoint, "block", "fixture-key"), /HTTP 403/);
        await bodyClosed;
    });
});

test("application exit zero cannot turn missing, failed or incomplete workload into success", () => {
    for (const workload of [undefined, { status: "failed" }, { status: "waiting-shells" }, { status: "ready" }]) {
        assert.equal(baselineOutcome(0, null, 10, workload).harnessExitCode, 1);
    }
    assert.equal(baselineOutcome(0, null, 0).harnessExitCode, 0);
    assert.equal(baselineOutcome(null, "SIGTERM", 0).harnessExitCode, 1);
});

test("baseline success requires every distinct shell startup and output receipt", () => {
    const shell = { shellPid: 1, outputVerified: true, historyAndUtf8Verified: true, startupReceiptMatched: true };
    const workload = { status: "ready", requested: 2, renderedXtermCount: 2, shellIdentitiesVerified: true,
        terminals: [shell, { ...shell, shellPid: 2 }] };
    assert.equal(baselineOutcome(0, null, 2, workload).harnessExitCode, 0);
    assert.equal(baselineOutcome(2, null, 2, workload).harnessExitCode, 2);
    assert.equal(baselineOutcome(0, null, 2, { ...workload, terminals: [shell, shell] }).harnessExitCode, 1);
    assert.equal(baselineOutcome(0, null, 2, { ...workload, shellIdentitiesVerified: false }).harnessExitCode, 1);
});

test("ConPTY six-column wrapping retains the complete framed PID", () => {
    const raw = "\x1b[?25hB0:209\x1b[?25l\x1b[H\n12:E  \x1b[1;5H\x1b[?25h";
    assert.equal(raw.match(/B0:(\d+):E/), null);
    assert.equal(compactPtyOutput(raw).match(/B0:(\d+):E/)[1], "20912");
    assert.equal(compactPtyOutput("Write-Output ('B' + '0:' + $PID + ':E')").match(/B0:(\d+):E/), null);
    assert.equal(compactPtyOutput("Write-Output ('BASELINE_' + 'SAFETY_FAILED')").includes("BASELINE_SAFETY_FAILED"), false);
    assert.equal(compactPtyOutput("BASELI\x1b[H\nNE_SAF\x1b[H\nETY_FA\x1b[H\nILED").includes("BASELINE_SAFETY_FAILED"), true);
});
