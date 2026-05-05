# Prompt cache Gateway recorder E2E

Status: completed
Created: 2026-05-04
Updated: 2026-05-05
Completed: 2026-05-05

## Goal

- Add a hosted-local diagnostic E2E that runs the real hosted Codex app-server against a local Vercel AI Gateway recorder and compares resumed-turn provider request prefixes for the same Linq thread.

## Success criteria

- Hosted Codex config supports a test-only, local-host-only model provider `base_url` override.
- Hosted-local can record `/v1/responses` requests without installing the fake Codex app-server shim.
- A focused Linq hosted-local E2E sends three inbound wakes for one member/thread, captures the real Codex Gateway request bodies, and fails with redacted prefix diagnostics when the provider body contains volatile prefix material.
- Focused tests cover override validation, env forwarding/rewriting, and the recorder helper behavior.

## Scope

- In scope: `packages/assistant-runtime` hosted Codex config/launch env, hosted-local Cloudflare env policy, hosted-local harness/helper tests, and a focused `apps/cloudflare` E2E scenario.
- Out of scope: changing production prompt construction, disabling native resume, usage-ledger schema changes, or touching unrelated hosted-onboarding edits.

## Constraints

- Technical constraints: provider request bodies stay in memory inside tests; diagnostics must not print raw prompts, transcripts, request bodies, provider keys, or local paths.
- Product/process constraints: preserve unrelated dirty work and keep the override test-only and local-host-only.

## Risks and mitigations

1. Risk: A test-only provider override becomes usable in production.
   Mitigation: validate `NODE_ENV=test`, require `http:` and loopback/local hostnames, and cover rejection cases.
2. Risk: Diagnostics leak prompt/request content in CI output.
   Mitigation: print bounded, sanitized first-diff windows plus lengths, indexes, code points, and hashes only.

## Tasks

1. Add the test-only hosted Codex model-provider base-url override. Done.
2. Forward and rewrite the override through hosted-local Cloudflare env policy. Done.
3. Extend the hosted-local assistant provider recorder to support real Codex streaming Responses calls without the fake shim. Done.
4. Add the three-inbound Linq Gateway-prefix diagnostic E2E and register it in the hosted-local harness. Done.
5. Run focused verification, completion audits, and close/commit the plan if safe. Done.

## Decisions

- Register `codex-gateway-prefix` as an explicit hosted-local E2E scenario, but exclude it from `all` because the cache-prefix assertion is diagnostic and may intentionally fail while provider behavior is being investigated.
- Keep provider request diagnostics redacted by reporting bounded first-diff windows, lengths, hashes, and code-unit metadata only.
- The diagnostic compares the first `/v1/responses` body observed for each Linq wake. The local recorder is capped at nine Responses bodies to avoid retry storms.
- Hosted Codex config disables Codex skill instructions and bundled skills so temporary runner-local skill paths do not enter provider prompts and break prefix caching.

## Progress

- Added the test-only local Codex model-provider base-url override and env forwarding/rewriting coverage.
- Extended the hosted-local assistant provider recorder for streaming Responses API calls from the real Codex app-server.
- Added the opt-in Linq three-turn Gateway-prefix E2E and hosted-local harness registration.
- Reproduced the local Gateway prefix issue with the real Codex app-server: three Linq wakes completed with zero mailbox lag, but the first provider request for each wake diverged at the volatile `/tmp/hosted-runner-launch-*` path embedded in Codex skill file references.
- Patched hosted Codex config to keep skill instructions disabled and added a regression guard documenting the prompt-cache invariant.
- Uncovered and patched a prerequisite hot-checkpoint correctness bug separately: hot snapshots without a base, and system-mailbox receipt checkpoints after activation, could omit canonical vault bootstrap state and prevent conversation wakes from reaching Codex.

## Verification

- Passed: `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/hosted-local-e2e-support.test.ts apps/cloudflare/test/runtime-bridge-workspace.test.ts --no-coverage`.
- Passed: `pnpm exec vitest run --config vitest.config.ts test/hosted-runtime-codex-config.test.ts test/hosted-runtime-environment.test.ts --no-coverage` from `packages/assistant-runtime`.
- Passed: `pnpm --dir apps/cloudflare runner:bundle:hosted-local`.
- Reproduced expected diagnostic failure before the skill-disable patch: `MURPH_E2E_STREAM_DEV_LOGS=0 pnpm hosted-local e2e codex-gateway-prefix --profile e2e:live --no-bundle`.
- Passed after scoped follow-up: `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --no-coverage test/hosted-runtime-codex-config.test.ts`.
- Passed after scoped follow-up: `pnpm --dir packages/assistant-runtime typecheck`.
- The long opt-in live `codex-gateway-prefix` E2E was not rerun after the skill-disable patch.

## Landed commits

- `9cade9eea` `test(cloudflare): add codex gateway prefix diagnostic`
- `43ac76d76` `test(assistant-runtime): guard hosted codex skill prompts`
