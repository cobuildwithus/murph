# PR 750 current-main integration

Status: completed
Created: 2026-07-20
Updated: 2026-07-20

## Goal

- Integrate current `main` after Round 10 PASS while preserving both main's
  unified scheduled/system-notification architecture and PR 750's reviewed
  completion isolation.

## Success criteria

- Main's prompt/tool/process-lifetime changes remain intact.
- Scheduled reviewed model turns remain provider-ephemeral, read-only,
  native-tool-disabled, non-resumable, and non-persistent while authorized
  Murph group tools remain available.
- Scheduled exact fallback remains provider-free and outbox-only; interactive
  exact behavior remains unchanged.
- Conflict resolution adds no state owner, profile framework, compatibility
  layer, or duplicate policy.
- Required focused and diff-aware verification passes on the merged head.

## Scope

- In scope: the six current-main conflict files, any directly required type/test
  adjustment, exact-head CI/mergeability proof, PR body current-head update.
- Out of scope: new disclosure behavior, new tool authority, phone scheduling,
  new persisted state.

## Decisions

- Treat Round 10 as the final PR-specific review for the reviewed patch. Base
  integration will preserve both sides without reopening unchanged behavior; if
  resolution changes PR-specific behavior, run the ordinary next review round.

## Verification

- `pnpm --filter @murphai/assistant-engine typecheck`: passed.
- Focused notification/provider/cron regression suite: 229 tests passed.
- `pnpm docs:drift-check`: passed.
- `git diff --check`: passed.
- `NODE_OPTIONS=--max-old-space-size=8192 MURPH_TEST_DIFF_VITEST_MAX_WORKERS=4 MURPH_CLI_VITEST_MAX_CONCURRENCY=1 pnpm test:diff`: passed in 1,178 seconds, including affected package tests, hosted Web verification and production build, and Cloudflare verification (1,841 Node tests plus worker tests).

## Outcome

- Current `main` is integrated through an ordinary two-parent merge.
- The conflict resolution composes the existing scheduled-turn profile owner
  with the reviewed-completion isolation predicate; it adds no new durable
  state, coordinator, compatibility layer, or policy framework.
- Round 10 remains the final PR-specific ReviewGPT round because the merge
  preserves the already-reviewed behavior and only reconciles base-owned
  profile names and scheduling classification.
Completed: 2026-07-20
