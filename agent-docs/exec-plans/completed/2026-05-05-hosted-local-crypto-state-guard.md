# Hosted-Local Crypto State Guard

Status: completed
Created: 2026-05-05
Updated: 2026-05-05

## Goal

Prevent hosted-local development from reusing or persisting test/remote hosted
crypto state as normal generated local crypto state.

Success criteria:

- `pnpm dev` only reuses generated hosted-local crypto material when the
  persisted state explicitly says `HOSTED_CRYPTO_ENV=local`.
- E2E/test hosted crypto state with `HOSTED_CRYPTO_ENV=test` does not get
  written back as normal reusable hosted-local state.
- Focused tests cover the contamination case that makes local DB envelopes fail
  authority verification.

## Scope

- `scripts/dev-hosted-local/environment.ts`
- `scripts/dev-hosted-local/environment.test.ts`

## Constraints

- Do not print or fixture secret values beyond existing synthetic test
  placeholders.
- Preserve explicit `MURPH_DEV_USE_REMOTE_HOSTED_CRYPTO_KEYS=1` behavior.
- Preserve unrelated active hosted-local runner work.

## Plan

1. Tighten hosted-local persisted crypto reuse to require `HOSTED_CRYPTO_ENV=local`.
2. Tighten hosted-local state-file persistence so non-local crypto/callback
   signing state is not retained for later `pnpm dev` runs.
3. Add focused regression tests for stale `test` state contamination.
4. Run focused script tests and the required typecheck path if not blocked by
   unrelated active work.

## Verification

- `pnpm exec vitest run --config scripts/vitest.config.ts scripts/dev-hosted-local/environment.test.ts --no-coverage` passed.
- `bash scripts/workspace-verify.sh test:diff scripts/dev-hosted-local/environment.ts scripts/dev-hosted-local/environment.test.ts` passed.
- `git diff --check -- scripts/dev-hosted-local/environment.ts scripts/dev-hosted-local/environment.test.ts agent-docs/exec-plans/active/2026-05-05-hosted-local-crypto-state-guard.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md` passed.
- Security/privacy review and final completion review found no issues in the
  hosted-local crypto state guard.
- Coverage-write review found the focused hosted-local contamination coverage
  sufficient and made no edits.
- `pnpm typecheck` is blocked by unrelated active hosted-web device-sync dirty
  ack work in `apps/web/src/lib/device-sync/hosted-runtime-authority.ts`:
  the returned object is missing `nextWakeAt` and `stillDirty` for
  `HostedExecutionDeviceSyncDirtyAckResponse`.
Completed: 2026-05-05
