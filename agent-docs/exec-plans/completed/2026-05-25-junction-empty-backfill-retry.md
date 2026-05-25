# Junction Empty Backfill Retry

## Goal

Make Junction historical backfill resilient when the initial provider hydration returns empty data even though the source later exposes records.

Success means a Junction-wide, provider-owned retry covers any Junction source, preserves the original historical window, keeps retry state in flat sanitized metadata, avoids hosted/job payload contract changes, and is proved by focused tests. The current verification pass also includes keeping typecheck/diff checks green across Murph Age CLI/schema contract drift exposed by reverse-dependent checks.

## Constraints

- Preserve unrelated working-tree changes.
- Do not log or fixture real health data, provider payloads, identifiers, secrets, local paths, or raw credentials.
- Keep the retry bounded, idempotent, and provider-local.
- Do not add job payload fields outside the existing Junction backfill manifest.
- Do not mark the historical backfill complete from a normal reconcile window.
- Keep any check-green fix outside Junction narrowly scoped to existing CLI/schema contracts.

## Plan

1. Add a small Junction helper that classifies empty historical backfills and builds bounded same-window retry jobs.
2. Persist only flat provider-prefixed metadata markers for retry status, attempts, last empty time, and historical window.
3. Add focused Junction provider tests for empty retry, non-empty completion, budget exhaustion, payload shape, and reconcile isolation.
4. Keep reverse-dependent typecheck surfaces aligned when diff checks expose unrelated local contract drift.
5. Run typecheck, focused device-sync verification, required audits, and close through the scoped commit path.

## Verification

- `pnpm --dir packages/device-syncd test -- junction-provider.test.ts` passed.
- `pnpm --dir packages/cli typecheck` passed.
- `pnpm --dir packages/cli exec vitest run --config vitest.workspace.ts --no-coverage test/murph-age-command.test.ts -t "age preview scores submitted labs and wearable context without a vault"` passed.
- `pnpm --dir packages/device-syncd typecheck` passed after simplify fixes.
- `pnpm typecheck` passed.
- `git diff --check` passed.
- `pnpm --dir packages/device-syncd test:coverage` passed.
- `pnpm test:diff packages/device-syncd/src/providers/junction.ts packages/device-syncd/test/junction-provider.test.ts packages/cli/src/commands/murph-age.ts packages/cli/test/murph-age-command.test.ts` passed.
Status: completed
Updated: 2026-05-24
Completed: 2026-05-24
