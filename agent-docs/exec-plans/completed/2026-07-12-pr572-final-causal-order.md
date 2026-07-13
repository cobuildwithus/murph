# PR 572 final causal-order remediation

## Goal

Replace importer-created preference reservations with one immutable mailbox
acceptance order shared by conversation and Settings mutations, while keeping
sparse per-field last-intent-wins behavior and bounded legacy replay.

## Proven failures

- A Settings event accepted before a conversation can receive a newer revision
  when delayed until local import and overwrite the newer conversational value.
- A pre-change pending preference item has no reservation and retries forever.
- A handled reservation can be evicted while its mailbox item is still pending,
  destroying the only replay proof.

## Implementation

1. Assign a serialized per-member causal sequence in the mailbox append owner
   and expose it as optional additive mailbox metadata during rollout.
2. Carry that sequence through system pending items and hosted conversation
   input records into the style CLI mutation. While a provider turn is live,
   atomically replace one runtime transport file before `turn/steer` so a
   later command observes the newest accepted sequence instead of the turn's
   initial environment.
3. Retain only per-field applied causal watermarks in canonical preferences;
   equal/older replays are terminal no-ops. Treat tokenless legacy pending work
   as causal sequence zero so it drains but cannot overwrite a post-upgrade
   mutation.
4. Delete reservation allocation, receipt retention, cap, and retry failure
   machinery. Update durable protocol and deployment documentation.

## Verification

- Focused core, assistant input/planning, hosted mailbox/runtime, web mailbox,
  and preferences tests, including both cross-lane orders, legacy restore, and
  post-commit replay beyond the former cap.
- Relevant package typechecks and generated contract/Prisma checks.
- Required completion audits, scoped finish-task commit, push, CI, PR threads,
  and merge-base reconciliation.

## Completion evidence

- ReviewGPT round 4 on audited head `966aaa5da7c554578b7622c41c0653aa78479eca`
  completed after 39 minutes and returned `REVIEW_COMPLETE`; its three connected
  High findings are the proven failures above and are all remediated by this
  plan. The user-authorized single-run policy forbids a duplicate after fixes.
- The granted coverage-write audit added the sparse personality-event boundary
  assertion and reported no remaining actionable coverage gap.
- Parent final review found and corrected the live-steer transport gap: hosted
  style commands now read one atomically replaced runtime file that is advanced
  before provider steering. The mailbox acceptance sequence remains the sole
  authority; the file is overwritten per turn and adds no queue or receipt
  lifecycle.
- Focused canonical, mailbox append, assistant planning, hosted runtime,
  parser, migration, and legacy crash/replay tests pass. Prisma and contract
  generation, all affected typechecks, dependency/boundary/privacy guards,
  and docs drift checks pass.
- The final live-sequence, steer-ordering, hosted-planning, and canonical
  preference lane passed 57/57; the focused contracts regression passed 9/9,
  and the assistant-engine plus vault-usecases typechecks passed after final
  contract generation.
- `pnpm test:diff` reached affected package tests after all guards and 22
  package/app typechecks passed. Its package fanout exposed two unrelated
  timeout-shaped failures: the workspace-runner case passed alone in 86 ms,
  and the unchanged-from-main outbox timestamp case passed with an isolated
  120-second test timeout after 77 seconds of test work.
- The branch was rebased onto `origin/main` during remediation; after final
  verification the base advanced through `a7694b3384b`. The scoped task commit
  will be rebased normally onto that exact base before push and CI.
Status: completed
Updated: 2026-07-12
Completed: 2026-07-12
