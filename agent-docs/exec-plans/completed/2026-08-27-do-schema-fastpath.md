# Durable Object schema activation fast path

Status: completed
Created: 2026-08-27
Updated: 2026-08-27

## Goal

- Reduce post-hibernation UserRunner Durable Object initialization work by
  trusting the persisted exact schema version and skipping repeated migration
  inspection when the schema is already current.

## Success criteria

- Current-version objects perform only the minimum schema-version admission work
  and skip repeated runner-table DDL, per-column PRAGMA scans, legacy migration
  checks, retired-table cleanup, and final migration assertions.
- New, older-version, missing-version, and future-version objects preserve their
  current create/migrate/fail-closed behavior.
- Focused tests prove both the reduced SQL call shape and every migration floor.
- The change adds no cache, state owner, dependency, background work, or retry.
- The exact pushed PR head clears required specialist/final ReviewGPT gates and
  required GitHub checks before merge.

## Scope

- In scope:
  - `RunnerStateStore` schema admission and its focused tests/docs.
  - A member-visible performance changelog entry if required by the changelog contract.
- Out of scope:
  - Changing schema version 17, persisted row shape, migrations, or runtime ownership.
  - Durable Object keepalive/prewarming, queues, container boot, or Cloudflare config.

## Constraints

- Technical constraints:
  - Reject a stored future version before constructing runtime services.
  - Keep first-use and legacy migration paths behaviorally identical.
  - Prefer deletion/early return over a cache or new abstraction.
- Product/process constraints:
  - ReviewGPT implements the production/test patch; the parent verifies and
    lands it through the normal PR lane.
  - Treat the member journey as a Product UX Patch: a reply after object idle
    should begin sooner with no visible semantic change or recovery regression.

## Risks and mitigations

1. Risk: trusting the version marker hides a partially migrated schema.
   Mitigation: prove the write ordering makes the current marker terminal, retain
   fail-closed runtime queries, and cover interrupted/legacy shapes directly.
2. Risk: optimization changes new-object or rollback behavior.
   Mitigation: keep all non-current versions on the existing full path and test
   exact SQL ordering for new, old, current, and future versions.

## Tasks

1. Completed: asked ReviewGPT to implement the smallest exact-version fast
   path and proof.
2. Completed: verified the exact artifact identity, read every hunk, and
   applied the returned three-file patch unchanged.
3. Completed: ran the focused schema/store suite, deterministic before/after
   operation proof, Cloudflare typecheck, changelog page suite, Web typecheck,
   and diff checks.
4. Completed: PR #2462 passed the Product UX/coverage specialist review, final
   full-patch audit, and required exact-head CI with no findings or failures.
5. In progress: merge the reviewed production candidate plus this plan-only
   closure and retire the task worktree.

## Decisions

- Use one persisted-version early return; do not add in-memory caching.
- Keep this PR independent of the observability PR so each can be reviewed and
  rolled back separately.
- Deterministic baseline proof on the production function records 21 SQL
  operations for an already-current version-17 schema: one metadata-table
  ensure, one runner-table ensure, two version reads, sixteen table-info
  scans, and one retired-table drop. The target exact-current path is two
  operations: the metadata-table ensure and one version read.

## Verification

- Commands to run:
  - `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts --no-coverage apps/cloudflare/test/runner-state-store.bundle-slots.test.ts`
  - `pnpm --dir apps/cloudflare typecheck`
  - `pnpm --dir apps/web test -- changelog-page.test.tsx`
  - `pnpm --dir apps/web typecheck`
  - `git diff --check`
- Expected outcomes:
  - All focused checks pass, current-version SQL work is materially smaller, and
    every non-current schema path retains its existing behavior.
- Results:
  - Schema/store suite: 19 passed.
  - Exact-current production function: 21 SQL operations before, 2 after.
  - Changelog page suite: 9 passed.
  - Cloudflare and Web typechecks passed.
  - `git diff --check` passed.
Completed: 2026-08-27
