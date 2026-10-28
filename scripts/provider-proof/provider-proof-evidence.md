# Provider proof evidence — 2026-10-29

Status: DONE_WITH_CONCERNS. Isolated protocol proofs delivered; live provider gate remains open.

## Verification

Commands run from the SLTerm source checkout:

```powershell
node --experimental-transform-types --test --test-concurrency=1 scripts/provider-proof/*.test.mjs
node scripts/provider-proof/check-codex-local.mjs
node scripts/provider-proof/check-sdk-types.mjs proof-results/provider-proof/sdk/package.tgz
```

- **15/15 fixtures passed**, 0 failures/skips. Framing covers every split position in a Vietnamese/emoji frame, coalesced messages, overflow, malformed UTF-8/JSON and partial EOF. Lifecycle fixtures cover initialization, typed request IDs, response errors/timeouts/disconnect, malformed correlated replies that fail closed, exact-action/single-use/replay protection, expiration, server resolution, cancellation receipt versus terminal completion, concurrent-approval revocation, callback abort and a stuck SDK interrupt/iterator.
- **Local CLI schema check passed:** installed `codex-cli 0.165.0-alpha.1.2`; all nine generated files exactly match committed SHA-256 pins. Only `--version` and `app-server generate-json-schema` ran, using a fresh profile and environment allowlist. The CLI warned that helper PATH aliases cannot be created under a temporary directory; schema generation still exited 0. No app-server session was launched.
- **SDK declaration typecheck passed:** TypeScript `5.9.3`, published `@anthropic-ai/claude-agent-sdk` `0.3.312`, SHA-512 verified against `protocol-pins.json`. Manifest identifies bundled Claude Code `2.1.312`. `skipLibCheck: true` excludes third-party declaration validation. Installed CLI `2.1.286` was inspected only with `--version` and was not substituted.
- Node `v24.12.0` uses its experimental TypeScript transform flag to execute isolated sources. No root package/config/lock file changed. No dependency was installed, no credentials discovered/copied, and no model request or account operation ran.

Evidence artifacts are ignored under `proof-results/provider-proof/`: the downloaded SDK archive, selected published declarations, generated schemas, typecheck configuration and isolated scratch profiles. No background process was started by this proof. An initial SDK checker run failed because Windows backslash glob paths produced no TypeScript inputs; the checker now normalizes paths and the actual source typecheck passes.

## Pins and primary sources

Exact schema hashes, package URL and SHA-512: [protocol-pins.json](protocol-pins.json). Sources and run instructions: [README.md](README.md).

- [OpenAI app-server documentation](https://developers.openai.com/codex/app-server) plus local version-matched schema generator.
- [Claude SDK overview](https://code.claude.com/docs/en/agent-sdk/overview), [approval callbacks](https://code.claude.com/docs/en/agent-sdk/user-input), [permission evaluation](https://code.claude.com/docs/en/agent-sdk/permissions), [streaming input](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode).
- [Official SDK repository](https://github.com/anthropics/claude-agent-sdk-typescript) and [published exact SDK package metadata](https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk/0.3.312). The browser could not fetch the oversized TypeScript reference page; package declarations supplied the API contract instead.

## Remaining evidence

Live provider auth, execution, real permissions/cancellation, actual spend enforcement, remote providers and SDK/platform/peer runtime compatibility remain unverified. Codex uses schema fixtures; Claude uses an explicitly injected SDK fixture. They are not live provider evidence. No claim covers a sandbox, OS managed policy isolation, real process-tree cleanup, SDK-internal buffers or host stdio write backpressure. These proof classes are not connected to the product.

Unresolved questions: none for this isolated scope. Further runtime/account validation retains the accepted plan's authorization gates.
