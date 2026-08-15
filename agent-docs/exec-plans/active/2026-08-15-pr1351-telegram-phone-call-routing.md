# Finish Telegram phone-call result routing

Status: active
Created: 2026-08-15
Updated: 2026-08-15

## Goal

Replace PR #1351's failed one-time workflow scaffold with the smallest durable
implementation that lets a canonical private Telegram scheduled occurrence use
the existing phone-call primitive and returns its asynchronous result only on
the initiating direct surface.

## Proven root cause

- The PR head contains only a trigger file and a self-removing finalizer
  workflow, not product code.
- The finalizer failed before verification because its generated transformation
  wrote the new Prisma migration file before creating the migration directory.
- The frontend-design workflow separately rejected the PR body's missing
  changelog declaration.

## Success criteria

- Direct Linq and Telegram phone calls persist only a bounded optional result
  surface on the existing `HostedPhoneCall` row before provider dispatch.
- Completion re-resolves only that persisted direct surface; missing or revoked
  routing retries without falling back to another surface.
- Scheduled occurrence keys remain channel-independent and exact replay requires
  stored/requested result-surface equality, including `null`.
- Group calls keep their existing durable thread authority and scheduled email
  and group calls remain unavailable.
- The one-time workflow and trigger are deleted from the PR changeset.
- Focused tests, affected typechecks, exact-head CI, preliminary specialist
  review, and final ReviewGPT all pass before merge.

## Plan

1. Recover the reviewed transformation and revalidate it against the current PR
   base and current owner contracts.
2. Apply the product implementation and focused proof directly in the PR
   worktree; delete the failed finalizer scaffolding.
3. Run focused verification, inspect the complete diff, commit, push, and update
   the PR intent and changelog contract.
4. Run the preliminary specialist pass and final ReviewGPT gate on the exact
   pushed head; resolve every accepted finding and rerun affected proof.
5. Require green exact-head CI, prove a clean merge against current `main`, mark
   the PR ready, merge it, and retire the task worktree.

## Verification log

- `pnpm install --frozen-lockfile` passed.
- `pnpm --dir apps/web prisma:generate` passed.
- `pnpm --dir apps/web changelog:generate` passed.
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage
  apps/web/test/phone-calls-service.test.ts
  apps/web/test/phone-calls-result-notification-store.test.ts
  apps/web/test/hosted-assistant-notification-destination.test.ts
  apps/web/test/hosted-phone-call-private-storage-classification.test.ts
  apps/web/test/changelog-fragments.test.ts apps/web/test/changelog.test.ts`
  passed: 6 files, 126 tests.
- `pnpm --dir packages/hosted-execution test --
  phone-call-result-notification-channel.test.ts` passed: 48 files, 533 tests.
- The assistant package test wrapper expanded the requested file list to the
  full package and one worker exceeded its 4 GB heap. The direct focused lane
  `pnpm exec vitest run --config vitest.config.ts --no-coverage
  test/assistant-phone-call-result-channel.test.ts
  test/assistant-phone-calls.test.ts
  test/assistant-codex-turn-planning.test.ts` passed: 3 files, 124 tests.
- `pnpm --dir packages/hosted-execution typecheck` passed.
- `pnpm --dir packages/assistant-engine typecheck` passed.
- `pnpm --dir apps/web typecheck` passed.
- Exact-head CI, preliminary specialists, and final ReviewGPT remain pending on
  the pushed candidate.
