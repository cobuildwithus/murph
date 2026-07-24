# PR 890 ReviewGPT Round 3 Remediation

Status: completed
Created: 2026-07-23
Updated: 2026-07-23

## Goal

Preserve the simple automatic-meal-closeout architecture while correcting the
three completion and ordering gaps introduced by the system-mailbox import-only
path.

## Finding Triage

- Accepted: import-only processing checkpoints the managed automation but skips
  the existing cron wake projection and post-checkpoint meal-photo staging
  cleanup.
- Accepted: absolute system-mailbox dispatch priority can starve fresh
  conversation work behind a retryable system item.
- Accepted: a captured meal does not currently count as engagement when its
  automatic 9pm closeout later becomes due.

All three findings are review-induced consequences of the Round 2 ordering
change and directly block the stated product outcome.

## Anomaly Retrospective

- Original requirement: an accepted meal capture idempotently creates one
  ordinary managed 9pm automation, which performs closeout and removes the
  retained canonical meal photos without another opt-in.
- First-reviewed authored-source shape: 726 additions and 72 deletions.
- Current authored-source shape before this remediation: 1,133 additions and
  212 deletions. Review-driven growth came primarily from product/privacy
  hardening and the general system-mailbox ordering correction.
- The repeated mechanism is the Round 2 import-only early return: it correctly
  separated deterministic import from model authorization, but accidentally
  bypassed generic completion work and promoted system lag ahead of all
  foreground work.
- Decision: continue in this PR because the three corrections are indivisible
  from the automatic-closeout outcome and can be made by reconnecting existing
  owners. Do not add another state owner, scheduler, queue, lifecycle,
  reconciliation pass, or compatibility path.
- Design boundary: reuse the canonical cron status projection and mailbox
  post-checkpoint effects; dispatch ordinary foreground work when it is
  runnable; use the existing accepted capture row only as engagement evidence
  for the automation it created.

## Success Criteria

- System-only import checkpoints the cron wake created by canonical import and
  runs staged cleanup only after the checkpoint succeeds.
- Fresh conversation or due model work cannot be starved by retryable system
  lag; blocked model work can still admit deterministic system-only import.
- A recent accepted meal capture permits its due managed closeout without
  changing AI-usage authorization.
- Focused tests, typechecks, canonical diff verification, acceptance,
  ReviewGPT Round 4, and exact-head CI pass.

## Tasks

1. Add production-faithful failing tests for the three accepted findings.
2. Reconnect generic cron projection and post-checkpoint effects.
3. Correct reconciliation and workflow dispatch ordering.
4. Restore recent accepted meal capture as narrowly scoped engagement evidence.
5. Verify, commit, push, update PR metadata, and run ReviewGPT Round 4.

## Evidence

- Production-path regression coverage passed for hosted import/checkpoint
  completion, reconciliation gates, mailbox capture evidence, and Temporal
  dispatch ordering.
- Affected assistant-runtime, hosted-web, and Temporal typechecks passed.
- Documentation drift and diff hygiene checks passed.
- `MURPH_VERIFY_EXECUTOR=crabbox pnpm test:diff ...` passed in a clean
  Blacksmith Testbox in 3m23s.
- `MURPH_VERIFY_EXECUTOR=crabbox pnpm verify:acceptance` passed all 31 workspace
  projects in a clean Blacksmith Testbox in 5m37s.
- Final diff privacy scan found no local account identifiers, home-directory
  paths, or credential-shaped additions.
- The correction adds no scheduler, queue, state owner, lifecycle,
  reconciliation pass, compatibility path, or dependency. It reconnects only
  existing cron projection, mailbox evidence, checkpoint effects, and workflow
  modes.
Completed: 2026-07-23
Completed: 2026-07-23
