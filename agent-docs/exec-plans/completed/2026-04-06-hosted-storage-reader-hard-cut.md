# Hard cut hosted legacy storage readers

Status: completed
Created: 2026-04-06
Updated: 2026-04-06

## Goal

- Remove hosted-only storage compatibility readers that still probe old object-key paths or auto-migrate stale Durable Object queue schema now that the hosted plane has no meaningful live production state.

## Success criteria

- Cloudflare hosted storage readers stop probing object keys derived from prior root keys for bundles, artifacts, env, journals, side effects, share packs, raw mail, device-sync runtime state, and pending usage records.
- Pending-usage record listing reads only the canonical current-prefix shape and no longer fans out over old key-derived prefixes.
- The hosted runner queue schema stops auto-migrating the legacy `runner_meta.activated` column and instead supports only the canonical `runtime_bootstrapped` schema.
- Tests and durable hosted docs reflect the hard cut and no longer assert old hosted key-path fallback behavior.
- Required verification passes.

## Scope

- In scope:
  - `apps/cloudflare/src/**`
  - `apps/cloudflare/test/**`
  - `apps/cloudflare/{README.md,DEPLOY.md}` if needed for durable behavior changes
- Out of scope:
  - Envelope `keyId` decryption support for current ciphertexts
  - Non-hosted runtime-state compatibility work already in progress elsewhere

## Constraints

- Hard cut hosted legacy readers; do not add a new migration shim.
- Preserve decryption-by-`keyId` support where it is still part of the current hosted crypto contract.
- Preserve unrelated worktree edits.

## Tasks

1. Identify the remaining hosted-only legacy readers and separate them from active keyring/decryption behavior.
2. Remove old object-key fallback readers and the pending-usage multi-prefix read path.
3. Remove the runner queue schema auto-migration from `activated` to `runtime_bootstrapped`.
4. Update tests and durable hosted docs to the canonical hosted storage shape.
5. Run required verification, close the plan, and commit the scoped diff.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `pnpm test`
- Outcomes:
  - `pnpm exec vitest run apps/cloudflare/test/storage-path-rotation.test.ts apps/cloudflare/test/runner-queue-store.test.ts apps/cloudflare/test/runner-queue-confidentiality.test.ts apps/cloudflare/test/device-sync-runtime-store.test.ts --config apps/cloudflare/vitest.config.ts` passed.
  - `pnpm typecheck` passed.
  - `pnpm test` failed in unrelated existing workspace assistant/CLI build lanes (`build:test-runtime:prepared`) while reporting pre-existing `assistant-core` / `assistant-cli` export and dist mismatch errors outside this hosted storage scope.
Completed: 2026-04-06
