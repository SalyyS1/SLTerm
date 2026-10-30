# Provider protocol proof

Milestone-zero evidence only. These files are isolated from the application, native host, and chat UI. No command below starts a provider, submits a model request, reads a login/profile, or installs a dependency.

## Run

From the SLTerm source checkout, with Node 24 and the project's existing `ajv` 6.12.6, TypeScript 5.9.3 and Node declarations installed:

```powershell
node --experimental-transform-types --test --test-concurrency=1 scripts/provider-proof/*.test.mjs
node scripts/provider-proof/check-codex-local.mjs
node scripts/provider-proof/check-sdk-types.mjs
```

The Codex checker accepts an explicit CLI executable as its first argument. The SDK checker fetches the exact public package in `protocol-pins.json`, verifies SHA-512, extracts only its manifest/declarations to ignored `proof-results/provider-proof`, and typechecks this source. Pass a local `.tgz` as the first argument for an offline check. It does not install or import the SDK. `skipLibCheck` deliberately excludes SDK peer declarations; this is an API usage check, not full dependency/runtime validation.

## Contracts and evidence

| Evidence | Scope |
| --- | --- |
| Local CLI schema | Codex `0.165.0-alpha.1.2`; eighteen exact generated schema files and SHA-256 hashes. Regeneration must match. |
| Schema fixtures | JSONL framing, initialization, correlated IDs/errors, thread/turn creation, assistant item/delta events, provider errors, command approval, resolution, turn cancellation and completion. |
| Published SDK declarations | Claude Agent SDK `0.3.312`, whose manifest selects Claude Code `2.1.312`. Thin TypeScript bridge uses `query`, `CanUseTool`, hooks, `interrupt`, `close`, explicit API key, model and USD run budget. |
| SDK fixtures | Injected SDK interface only. On-demand loading, API-only environment, isolated profile, approval expiration/abort/replay, cancellation timeout, error redaction. These are not SDK runtime or account checks. |

Codex sends newline-delimited JSON without a `jsonrpc` header. The initialization request advertises `experimentalApi: false` and opts out of automatic gateway OAuth. Cancellation receipt does not finish a turn; a matching `turn/completed` event does. Only single-action command decisions are implemented. Other server requests get `-32601`; session-wide/persistent approvals are excluded from this narrow proof.

### Chat schema foundation

The eighteen pins include these nine additional, unmodified generated schemas:

| Method | Payload schema |
| --- | --- |
| `thread/start` | `ThreadStartParams`, `ThreadStartResponse` |
| `thread/started` | `ThreadStartedNotification` |
| `turn/start` | `TurnStartParams`, `TurnStartResponse` |
| `item/started` | `ItemStartedNotification` |
| `item/completed` | `ItemCompletedNotification` |
| `item/agentMessage/delta` | `AgentMessageDeltaNotification` |
| `error` | `ErrorNotification` |

`codex-chat-schema.test.mjs` validates offline payload fixtures through the same hash-checked validators as the proof peer. The selected version requires `startedAtMs` on item starts, `completedAtMs` on item completion, and `willRetry` on provider error notifications. The response fixtures include the generated thread metadata and negotiated policy fields. These tests validate payloads, not JSON-RPC envelopes or live event ordering.

The generated schemas deliberately permit extra properties and forward-compatible error information in some places. Validation preserves that behavior; it does not establish application approval policy, supported-message dispatch, identity correlation, path authorization or integer-format ranges. The schema catalog is exposed as an immutable list; unpinned names are rejected. `CodexPeer` still lacks thread/turn submission and streamed chat handling. Pin expansion is a foundation for that implementation, not connected application chat.

The application approval ledger binds a snapshot to provider turn, request ID, random generation and hash. It rejects changed tokens, duplicate IDs, expired decisions and retired turns. Buffers are limited to 256 KiB per frame/action/event; outstanding requests and approvals to 64, and the per-turn replay ledger to 4096. These are transport storage bounds, not limits on agent count. A full adapter must roll its connection/turn or fail explicitly at the ledger boundary. The host must honor stdio write backpressure; this in-memory peer does not launch processes or own an output queue.

The Claude bridge imports its SDK only when an explicitly configured generator is consumed. A caller must supply an API key, model, positive USD run budget and isolated scratch parent. It never discovers credentials. SDK environment replacement, fresh HOME/config paths, and empty `settingSources` prevent normal user/project configuration inheritance. A `PreToolUse` ask hook routes tool actions through the exact-action callback. Host cancellation invalidates approvals, bounds the `interrupt()` wait, aborts the SDK and invokes `close()`; awaiting a stuck iterator is also interrupted. Scratch profile directories are retained under the caller's ignored proof-results directory for inspection.

## Remaining gates

- Codex app-server startup/real initialization, model requests, real server approvals/cancellation, and provider budget enforcement were not run. The local branded alpha may differ from a release CLI; the schema/version pin is intentionally exact.
- Claude SDK runtime/platform binary and peer dependencies are not installed or executed. Observed local Claude CLI `2.1.286` does not match the SDK's `2.1.312` runtime and is not substituted.
- No API account, credential flow, live permissions, tool execution, spend enforcement, remote provider session, process-tree cleanup or SDK-internal byte-buffer limit is claimed. Desktop/OS managed configuration isolation also needs real SDK verification before product integration.
- Production integration needs tracked process launch, bounded stdio write backpressure, real schemas for other approval types, trusted executable distribution, and explicit authorization for account access.

## Primary sources

Chat schema pins regenerated and checked 2026-10-31; earlier proof sources checked 2026-10-28. Schemas are unmodified output from the locally installed CLI; they are interface evidence, not live service evidence.

- [OpenAI app-server protocol](https://learn.chatgpt.com/docs/app-server): initialization, JSONL, thread/turn and item lifecycle, capabilities, cancellation and approvals. Exact fields come from the selected CLI's `generate-json-schema` output.
- [Claude Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview): supported embedding route and API authentication for third-party products.
- [Claude approvals](https://code.claude.com/docs/en/agent-sdk/user-input) and [permissions](https://code.claude.com/docs/en/agent-sdk/permissions): callback and hook behavior.
- [Claude streaming input](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode): streaming query control.
- [Official SDK TypeScript repository](https://github.com/anthropics/claude-agent-sdk-typescript) and [published pinned SDK manifest](https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk/0.3.312). The large TypeScript reference page could not be fetched by the browser; published declarations were used directly. SDK files are retained only in ignored scratch, not vendored into the source tree.
