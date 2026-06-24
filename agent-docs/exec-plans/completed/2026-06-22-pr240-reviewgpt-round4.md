# PR 240 ReviewGPT round 4 fixes

Status: completed
Created: 2026-06-22
Updated: 2026-06-22

## Goal

- Resolve accepted ReviewGPT round-4 findings for PR 240 with the smallest changes in existing retention and inbox projection owners.

## Success criteria

- Retention never follows symlinked vault ancestors when hashing or deleting media.
- Missing already-tombstoned inbox media does not consume retention batch capacity or cause immediate wake loops.
- Deduplicated capture replay preserves the same retention-expired attachment overlay as full runtime rebuild.
- Focused regressions, required checks, and another ReviewGPT round pass before handoff.

## Scope

- In scope:
  - `packages/inboxd` retention file containment, tombstone candidate selection, and dedupe projection overlay.
  - `packages/core` path-safety primitive reuse if needed.
  - Focused tests for the accepted findings.
- Out of scope:
  - New retention schedulers, new persisted indexes, or broad snapshot/restore changes.
  - Any unrelated inbox runtime refactor.

## Constraints

- Keep deletion/tombstone ownership in `runInboxMediaRetention`.
- Prefer existing path-safety and retention overlay primitives over new abstractions.
- Do not add a new database/index owner for retention state.

## Risks and mitigations

1. Risk: Symlink fix duplicates path-safety logic.
   Mitigation: reuse the existing on-disk vault path resolver.
2. Risk: Tombstone skip changes valid retry behavior.
   Mitigation: skip only missing files already represented by retention records; still process existing files normally.
3. Risk: Dedupe overlay drifts from rebuild overlay.
   Mitigation: route through the same retention record read/overlay path used by rebuild.

## Tasks

1. Verify each round-4 finding against code paths.
2. Add focused regression tests.
3. Implement minimal fixes in existing owners.
4. Run focused and required verification.
5. Finish the plan, commit, push, and run the next ReviewGPT PR round.

## Decisions

- Accepted the symlinked-parent deletion finding. Retention now resolves candidate paths with the existing on-disk vault path primitive before hashing or deleting and treats symlink traversal as an invalid candidate.
- Accepted the tombstoned-missing batch loop finding. Missing files that already have retention records are skipped before batch admission, while reappeared tombstoned bytes are still deleted.
- Accepted the dedupe replay finding. `findStoredCaptureEnvelope` now applies the same retention map and retained parser projection hydration used by rebuild before returning a stored canonical envelope.

## Verification

- Completed:
  - `pnpm --filter @murphai/inboxd typecheck`
  - `pnpm --filter @murphai/inboxd exec vitest run --config vitest.config.ts test/inbox-media-retention.test.ts --no-coverage`
  - `pnpm --filter @murphai/inboxd test`
  - `pnpm typecheck`
  - `pnpm docs:drift`
  - `pnpm test:smoke`
  - `pnpm test:diff`
  - `git diff --check`
  - Privacy diff scan.
- Remaining:
  - Next `pnpm review:gpt pr-review` round after push.
Completed: 2026-06-22
