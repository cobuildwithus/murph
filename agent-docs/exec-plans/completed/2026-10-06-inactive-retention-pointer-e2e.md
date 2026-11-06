# Expect the kept system pointer in the inactive retention e2e

Status: completed
Created: 2026-10-06
Updated: 2026-10-06

## Goal

- Align the hosted-local Temporal e2e with the inactive-member scheduling
  contract in `references/hosted-temporal-orchestration.md`: inactive facts
  redact mailbox lag, so Temporal keeps the carried system pointer for
  activation and runs only due retention.

## Success criteria

- The `paused-retention` scenario asserts the pointer is kept (system lane, the
  appended item's sequence) instead of null; every other assertion (retention
  ran and cleared, the item stays unconsumed, no provider request) is unchanged.
- The private worker release integration passes with private main `f77c50f529`.

## Scope

- In scope: one assertion and the test name.
- Out of scope: runtime code in either repository.

## Constraints

- Technical constraints: the scenario runs only in murph-cloud's release
  integration against private main, which now carries the inactive-workspace
  quiescence marker; no public CI lane runs it against an older worker.
- Product/process constraints: none; test-only.

## Risks and mitigations

1. Risk: the later assertions never ran under the new behavior, because the old
   assertion failed first.
   Mitigation: the release integration rerun is the proof; the workflow tests in
   murph-cloud PR 183 already cover retention-only dispatch and pointer
   preservation.

## Tasks

1. Update the assertion, merge, rerun the private worker release.

## Decisions

- Assert `toMatchObject({ lane, laneSeq })` against the appended wake rather
  than a literal, so the check follows the scenario's own data.
- Changelog: not applicable; test-only.

## Verification

- Private release integration run 37494583352 (private `f77c50f529`, public
  `b6f29c40db`) failed only this scenario: `expected { lane: 'system',
  laneSeq: '2', … } to be null`; 18 other lanes passed.
- `pnpm --dir apps/cloudflare typecheck` passed.
- Post-merge: rerun the worker release integration.
Completed: 2026-10-06
