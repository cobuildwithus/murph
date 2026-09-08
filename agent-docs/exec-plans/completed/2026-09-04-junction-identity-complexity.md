# Junction timeseries identity complexity cleanup

## Outcome and scope

Reduce duplicated alias selection and unreachable resource branches in the existing Junction provider identity owner. Keep provider requests, pagination, source admission, canonical import ordering, row identities, conflict rejection, and recovery unchanged. No state owner, public API, dependency, or product promise changes.

## Evidence and plan

- Open PR inventory contains no existing change to the provider file; this task owns an isolated branch and worktree.
- The temporal-authority set contains blood oxygen and stress level. Their early return makes the later point branches unreachable. Body identity returns before the redundant weight provider-id branch.
- Replace repeated flat nullish chains with ordered field selection preserving empty strings, zero, false, alias order, and string coercion.
- Prove equivalent deduplication at the provider import boundary, including contradictory alias values and source revision differences; retain existing sparse/body conflict tests.
- Run focused Junction provider suites, package typecheck, complexity guard, and diff review. Close this plan through finish-task, open a draft PR, obtain parent candidate review, then run final ReviewGPT concurrently with required CI.

## Product UX and architecture

Internal behavior-preserving refactor; no changed member journey or assistant input. Existing provider and importer remain the authority owners. Changelog is not applicable because no member-visible behavior changes.

## Status

Local implementation complete. The identity function falls from complexity 120 to 33; file debt falls from 493 to 406, with the unchanged resource job maximum remaining 145.

- `pnpm --dir packages/device-syncd test test/junction-provider-identity.test.ts test/junction-provider-resources.test.ts test/junction-provider-history.test.ts test/junction-provider-history-recovery.test.ts test/junction-provider-backfill.test.ts test/junction-blood-pressure-backfill.test.ts`: 319 tests pass across six files.
- The new identity suite also passes all 34 cases against the untouched base implementation, establishing behavior preservation at the provider import callback.
- `pnpm --dir packages/device-syncd typecheck`: pass; no import/export or package boundary changes require an emitted build.
- `pnpm complexity:diff --base 603ea873bf4d0652805d0577081c43d64d6e0f61 -- packages/device-syncd/src/providers/junction.ts`: pass.
- Diff and privacy readback complete; existing Frog inventory inspected, with no new qualifying repository friction.

The local plan is complete. Draft PR, parent candidate review, final ReviewGPT, and required exact-head CI are the remaining external gates; no merge is authorized.
Status: completed
Updated: 2026-09-04
Completed: 2026-09-04
