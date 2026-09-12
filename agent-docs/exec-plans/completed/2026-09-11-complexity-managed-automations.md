# Simplify managed automation reconciliation

Status: completed
Created: 2026-09-11
Updated: 2026-09-11

## Goal

Reduce the branching in managed automation reconciliation while preserving every persisted record, scheduling decision, diagnostic stage, yield boundary, and result counter.

## Scope and ownership

Change the existing assistant-engine managed-automations owner and focused synthetic tests only. Core remains the canonical automation writer. Keep exact automation identity and owner scope, existing route and slug ownership, per-pass lazy lookup caches, one captured clock, and experiment desired-state uncertainty unchanged. No prompts, provider input, schemas, or new runtime state owners change.

## Evidence and approach

The coordinator combines lifecycle preparation, creation, reconciliation, and onboarding maintenance. Extract creation and update decisions into named local helpers and share the duplicated seed-owned write fields. Preserve read/write order and omitted versus explicit-null fields. Avoid a generic state machine or dispatcher.

## Risks and proof

- Yielding must retain completed counts without starting another write; exercise partial completion and resume.
- Existing weekly schedules and device one-shots must survive seed refresh; retain stale/legacy one-shot tests.
- Wrong-owner records must archive; routes and custom slugs must remain user/runtime owned.
- Failed optional lifecycle scans must not reconcile unknown desired state as empty.

## Tasks

1. Extract the bounded seed creation and reconciliation paths.
2. Run focused managed automation, onboarding check-in, and experiment support suites, engine typecheck, and complexity guard with one worker/checker.
3. Inspect the complete diff, close the plan, commit, push, and open a complete draft PR for parent candidate review and ReviewGPT.

## Verification

- Passed: `MURPH_VITEST_MAX_WORKERS=1 pnpm --dir packages/assistant-engine test test/managed-automations.test.ts test/managed-automations-core.test.ts test/onboarding-goal-checkin-automation.test.ts test/experiment-support-automations.test.ts` — 4 files, 165 tests.
- Passed: `MURPH_TSC_PACKAGE_CHECKERS=1 pnpm --dir packages/assistant-engine typecheck`.
- Passed: `pnpm complexity:diff --base HEAD -- packages/assistant-engine/src/assistant/managed-automations.ts` — debt 98 to 46, maximum 109 to 57. The untouched onboarding migration helper remains 29; the remaining coordinator preserves lifecycle ordering, caches, and yield boundaries.
- Passed: `git diff --check` and inspection of the complete source/test diff for privacy and ownership.
- The new regression verifies a persisted update retains its counter across a later foreground yield, omitted seed fields remain absent, and resume creates only the missing record.
- Creation and reconciliation now share seed-owned write fields. Onboarding follow-up uses a local helper; its removed unavailable-key assignment was dead because no later stage resolves that key.
- Parent inspected the source candidate. The complete draft PR, exact-head CI, Ready transition, and ReviewGPT remain with the parent completion owner.

Internal behavior-preserving refactor; no changelog or real-model journey is needed because prompts, tool contracts, and composed provider input are unchanged.
Completed: 2026-09-11
