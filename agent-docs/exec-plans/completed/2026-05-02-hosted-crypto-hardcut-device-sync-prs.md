# Land hosted crypto hard-cut device-sync patch

Status: completed
Created: 2026-05-02
Updated: 2026-05-02

## Goal

- Land the supplied hosted crypto hard-cut/device-sync patch against the current
  dirty checkout while preserving unrelated active work.

## Success criteria

- Hosted crypto hard-cut guard is wired into workspace verification.
- Hosted web private-field AAD includes stable row/table context without losing
  the in-flight transaction propagation change.
- Device-sync credential encryption uses hosted `device` secure-box and routing
  lookups use `HOSTED_DEVICE_ROUTING_INDEX_KEY`.
- Normal hosted runtime paths no longer require `DEVICE_SYNC_ENCRYPTION_KEY`.
- Focused tests/typecheck for the touched app surfaces pass or unrelated
  blockers are documented.

## Scope

- In scope:
  - Supplied patch files under hosted crypto, device-sync, local dev env, docs,
    env examples, setup tests, and workspace verification.
  - Manual merge of the `apps/web/src/lib/hosted-web/encryption.ts` AAD hunk
    with the existing Prisma transaction propagation change.
- Out of scope:
  - Existing Health Commons/experiments dirty work.
  - Existing hosted onboarding transaction fix except for preserving its
    `hosted-web/encryption.ts` changes.

## Constraints

- Technical constraints:
  - Do not reintroduce synchronous device-sync credential codecs.
  - Do not weaken hosted secure-box hard-cut checks or env fail-closed behavior.
- Product/process constraints:
  - Keep commits scoped to the supplied patch plus manual overlap resolution.

## Risks and mitigations

1. Risk: Patch overlap drops the existing hosted-web transaction propagation fix.
   Mitigation: Apply all other hunks with `git apply --exclude`, then manually
   merge only the hosted-web AAD additions into the current file.

## Tasks

1. Apply supplied patch excluding the overlapping hosted-web encryption file.
2. Manually merge hosted-web private-field AAD strengthening.
3. Run focused verification for hard-cut guard, env, device-sync, and typecheck.
4. Commit only scoped patch paths if checks are acceptable.

## Decisions

- Treat the supplied patch as behavioral intent rather than overwrite authority
  because the checkout already has active hosted-web encryption edits.

## Verification

- Passed:
  - `node scripts/check-hosted-crypto-hardcut.mjs`
  - `pnpm exec vitest run apps/web/test/env.test.ts apps/web/test/device-sync-hosted-wake.test.ts apps/web/test/prisma-store-oauth-connection.test.ts --config apps/web/vitest.config.ts --no-coverage`
  - `pnpm --dir apps/web typecheck`
  - `pnpm typecheck`
  - `git diff --check` for scoped follow-up files
- Required security/privacy, coverage-write, and task-finish-review passes
  completed; follow-up fixes were landed for env presence rejection, guard
  allowlist narrowing, and focused test coverage.
