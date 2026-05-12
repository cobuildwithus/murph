# Archive stale Cloudflare execution plans

Status: completed
Created: 2026-05-12
Updated: 2026-05-12

## Goal

- Remove stale Cloudflare execution-plan artifacts from the active plan set so future agents do not revive the removed runner-token or `deferredCheckpointRequired` architectures.

## Success criteria

- `agent-docs/exec-plans/active/token-cleanup.md` is no longer active.
- `agent-docs/exec-plans/active/big-refactor-bug-fix.md` is no longer active.
- The coordination ledger no longer points at `agent-docs/exec-plans/active/big-refactor-bug-fix.md`.
- Active plans no longer reference `deferredCheckpointRequired`.

## Scope

- In scope: active execution-plan cleanup, the matching coordination-ledger row, and this cleanup plan.
- Out of scope: runtime code changes and edits to immutable completed-plan snapshots.

## Constraints

- Technical constraints: use the repo plan lifecycle scripts where possible.
- Product/process constraints: preserve unrelated active plan rows and unrelated dirty worktree edits.

## Risks and mitigations

1. Risk: Archiving a plan another agent still needs.
   Mitigation: Limit cleanup to plans that reference removed architecture or already-landed token work, and leave newer specific runner plans active.

## Tasks

1. Identify stale active plans and ledger references.
2. Archive stale active plans.
3. Remove the obsolete ledger row for the archived broad runner plan.
4. Read back and verify active plan searches.

## Decisions

- Completed execution-plan snapshots are left as historical records; cleanup targets the active plan set only.

## Verification

- Direct readback confirmed both stale plans moved to `agent-docs/exec-plans/completed/` and the broad-runner ledger row was removed in the worktree.
- `git diff --check -- <touched plan paths>` passed.
- `rg -n "agent-docs/exec-plans/active/big-refactor-bug-fix\\.md|agent-docs/exec-plans/active/token-cleanup\\.md|deferredCheckpointRequired" agent-docs/exec-plans/active --glob '!2026-05-12-stale-cloudflare-plan-cleanup.md' --glob '!COORDINATION_LEDGER.md'` returned no matches.
- `pnpm typecheck` failed in unrelated Murph Age script work outside this docs change (`scripts/murph-age/r399-midus2-biomarker-increment.ts` missing `uniqueColumns` and one argument-count mismatch).
- `pnpm test` failed in unrelated CLI coverage (`packages/cli/test/device-cli.test.ts` timed out in `device connect uses hosted CLI bridge in hosted runtime without local daemon credentials`).
Completed: 2026-05-12
