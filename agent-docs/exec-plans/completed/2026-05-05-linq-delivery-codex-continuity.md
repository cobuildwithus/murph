# Linq Delivery Codex Continuity

## Goal

Fix the failing Linq delivery hosted-local E2E gate where the test Codex app-server shim creates assistant resume state without corresponding Codex provider continuity in the hosted workspace snapshot.

## Scope

- `packages/assistant-runtime/src/hosted-runtime/codex-e2e-app-server-stub.ts`
- `packages/assistant-runtime/src/hosted-runtime/codex-config.ts` as the thin installer caller
- `packages/assistant-runtime/test/hosted-runtime-codex-config.test.ts`
- Focused hosted-local Linq delivery verification if feasible.

## Constraints

- Preserve the production snapshot invariant: if assistant session resume state is persisted, the matching Codex home continuity must survive checkpoint/restore.
- Do not weaken privacy, auth, or hosted snapshot fail-closed behavior to make tests pass.
- Keep shim continuity synthetic and metadata-only; do not write prompts, response text, provider requests, or user payloads.
- Preserve unrelated dirty work in the checkout.

## Status

- Root cause identified from CI: `checkpoint.codex_continuity_missing_after_full_fallback` after a successful Linq reply turn, followed by a later turn failing because the queued assistant response was already consumed.
- Extracted the test-only app-server shim out of hosted Codex config.
- Added a metadata-only continuity write under `CODEX_HOME/rollouts` on `thread/start` and `thread/resume`.
- Focused Codex config regression coverage passes and asserts the continuity marker does not persist prompts or assistant responses.

## Verification Plan

- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts test/hosted-runtime-codex-config.test.ts --no-coverage` passed.
- `pnpm --dir packages/assistant-runtime typecheck` passed.
- `pnpm typecheck` passed.
- `MURPH_E2E_STREAM_DEV_LOGS=0 MURPH_HOSTED_LOCAL_E2E_FAST_GATE=1 pnpm hosted-local e2e linq-delivery` was attempted twice locally and failed before the Linq scenario because the local Cloudflare dev process exited during stack startup.
Status: completed
Updated: 2026-05-05
Completed: 2026-05-05
