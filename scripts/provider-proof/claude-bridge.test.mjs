import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { ClaudeBridge } from "./claude-bridge.ts";

const resultsRoot = fileURLToPath(new URL("../../proof-results/provider-proof/", import.meta.url));
await mkdir(resultsRoot, { recursive: true });
const scratchRoot = await mkdtemp(resolve(resultsRoot, "sdk-fixture-"));
test.after(async () => {
    assert.ok(resolve(scratchRoot).startsWith(resolve(resultsRoot) + "/") || resolve(scratchRoot).startsWith(resolve(resultsRoot) + "\\"));
    await rm(scratchRoot, { recursive: true, force: true });
});

function fixture({ stuckInterrupt = false, nextError = false, approvalTtlMs } = {}) {
    let options;
    let loaded = 0;
    let startedResolve;
    let interrupts = 0;
    let closes = 0;
    const started = new Promise((resolve) => { startedResolve = resolve; });
    const approvals = [];
    const config = { apiKey: "fixture-not-a-real-api-key", cwd: scratchRoot, scratchRoot,
        model: "fixture-explicit-model", maxBudgetUsd: 0.25, processEnvironment: {},
        onApproval: (approval) => approvals.push(approval), cancelTimeoutMs: 20, approvalTtlMs };
    const bridge = new ClaudeBridge(config, async () => {
        loaded++;
        return { query: (params) => {
            options = params.options;
            startedResolve();
            return {
                [Symbol.asyncIterator]() { return this; },
                next: () => nextError ? Promise.reject(new Error("fixture-sensitive-stderr")) : new Promise(() => {}),
                interrupt: () => { interrupts++; return stuckInterrupt ? new Promise(() => {}) : Promise.resolve(undefined); },
                close: () => { closes++; },
            };
        } };
    });
    const ask = (id, input = { command: "fixture-do-not-execute" }, signal = new AbortController().signal) =>
        options.canUseTool("Bash", input, { signal, requestId: id, toolUseID: `tool-${id}` });
    return { bridge, approvals, started, ask, config, get options() { return options; },
        get loaded() { return loaded; }, get interrupts() { return interrupts; }, get closes() { return closes; } };
}

test("SDK fixture: on-demand API-only options, isolated profile, selected model and budget", async () => {
    const f = fixture();
    const iterator = f.bridge.run("fixture prompt");
    assert.equal(f.loaded, 0);
    const next = iterator.next();
    const stopped = assert.rejects(next, /RUN_CANCELLED/);
    await f.started;
    assert.equal(f.loaded, 1);
    assert.equal(f.options.env.ANTHROPIC_API_KEY, "fixture-not-a-real-api-key");
    assert.equal(f.options.env.CLAUDE_CONFIG_DIR, f.options.env.HOME);
    assert.notEqual(f.options.env.HOME, scratchRoot);
    assert.deepEqual(f.options.settingSources, []);
    assert.equal(f.options.persistSession, false);
    assert.equal(f.options.permissionMode, "default");
    assert.equal(f.options.maxBudgetUsd, 0.25);
    assert.equal(f.options.model, "fixture-explicit-model");
    assert.equal("ANTHROPIC_AUTH_TOKEN" in f.options.env, false);
    assert.equal("CLAUDE_CODE_OAUTH_TOKEN" in f.options.env, false);
    const hook = await f.options.hooks.PreToolUse[0].hooks[0]();
    assert.equal(hook.hookSpecificOutput.permissionDecision, "ask");
    await f.bridge.cancel();
    await stopped;
    assert.equal(f.interrupts, 1);
    assert.ok(f.closes >= 1);
});

test("SDK fixture: immutable exact action, duplicate request and stale decision rejection", async () => {
    const f = fixture();
    const stopped = assert.rejects(f.bridge.run("fixture").next(), /RUN_CANCELLED/);
    await f.started;
    const input = { command: "original-fixture" };
    const decision = f.ask("approval", input);
    const approval = f.approvals[0];
    input.command = "mutated-after-ask";
    const duplicate = await f.ask("approval");
    assert.equal(duplicate.behavior, "deny");
    assert.throws(() => f.bridge.decide("approval", "wrong", true), /APPROVAL_ACTION_MISMATCH/);
    f.bridge.decide("approval", approval.token, true);
    assert.deepEqual(await decision, { behavior: "allow", updatedInput: { command: "original-fixture" } });
    assert.throws(() => f.bridge.decide("approval", approval.token, true), /STALE_APPROVAL/);
    const oldCallback = f.options.canUseTool;
    await f.bridge.cancel();
    await stopped;
    const late = await oldCallback("Bash", {}, { signal: new AbortController().signal, requestId: "late", toolUseID: "late" });
    assert.equal(late.behavior, "deny");
});

test("SDK fixture: callback abort, deadline and cancellation deny pending actions", async () => {
    const f = fixture({ approvalTtlMs: 10, stuckInterrupt: true });
    const stopped = assert.rejects(f.bridge.run("fixture").next(), /RUN_CANCELLED/);
    await f.started;
    const controller = new AbortController();
    const aborted = f.ask("aborted", {}, controller.signal);
    controller.abort();
    assert.equal((await aborted).behavior, "deny");
    const expired = f.ask("expired");
    const keepAlive = setTimeout(() => {}, 50);
    assert.equal((await expired).behavior, "deny");
    clearTimeout(keepAlive);
    const pending = f.ask("pending");
    await f.bridge.cancel();
    assert.equal((await pending).behavior, "deny");
    await stopped;
    assert.throws(() => f.bridge.decide("pending", f.approvals.at(-1).token, true), /RUN_NOT_APPROVABLE/);
});

test("SDK fixture: credentials, environment, budget validation and SDK errors", async () => {
    const f = fixture({ nextError: true });
    assert.throws(() => new ClaudeBridge({ ...f.config, apiKey: "" }), /API_AUTH_REQUIRED/);
    assert.throws(() => new ClaudeBridge({ ...f.config, processEnvironment: { CLAUDE_CODE_OAUTH_TOKEN: "fixture" } }), /UNSUPPORTED_ENVIRONMENT_VARIABLE/);
    assert.throws(() => new ClaudeBridge({ ...f.config, maxBudgetUsd: 0 }), /RUN_BUDGET_REQUIRED/);
    await assert.rejects(f.bridge.run("fixture").next(), (error) => error.message === "SDK_RUN_FAILED");
    assert.equal(f.closes, 1);
});
