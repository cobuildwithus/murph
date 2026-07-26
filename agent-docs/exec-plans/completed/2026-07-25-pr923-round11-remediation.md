# PR 923 ReviewGPT round 11 remediation

Status: completed
Created: 2026-07-25
PR: `#923`
Branch: `agent/challenge-sleep-stage-workout-times`

## Outcome

Resolve the two accepted round-11 findings without changing the selected
producer-watermark or typed-partial architecture:

1. Derive the workout source-read cutoff from the same fixed UTC-12 producer
   calendar as the emitted seven-date window, including the one preceding UTC
   date needed for positive-offset conversion on the oldest producer date.
2. Describe and prove the uniform keyed three-state model envelope accurately;
   only `workouts.v0` receives additional day/kind record compaction.

## Invariants

- Keep the 500-row source cap and seven-date final filter fail-closed.
- Do not add a clock owner, scheduler, queue, persisted state, compatibility
  shape, or pagination mechanism.
- Preserve exact grants and the distinct `not_granted`, `missing`, and
  `available` states for every projection.
- Preserve non-workout record payloads and complete encrypted/Web truth.

## Verification evidence

- UTC-midnight boundary proof passes immediately before and after UTC midnight,
  keeps the same July 2 Tokyo workout and July 7 watermark, then proves the
  window advances at 12:00 UTC without leaking July 2.
- Mixed workouts/daily-metric/device-status proof passes with `available`,
  `missing`, and `not_granted`, intact non-workout records, workout-only
  day/kind compaction, and a bounded serialized result.
- Focused runtime and engine files pass 80 and 61 tests respectively.
- Runtime and engine owner typechecks pass.
- Canonical
  `pnpm test:diff packages/assistant-runtime packages/assistant-engine` passes:
  guards, all affected typechecks, assistant-engine 2,674 tests,
  assistant-runtime 1,884 tests, assistant-cli 128, assistantd 40, CLI 1,083,
  setup CLI 124, Cloudflare Node 1,898, and Cloudflare Workers 2.
- Parent final review confirms the source cutoff and output window share the
  same fixed calendar, the 500-row cap and seven-date filter remain unchanged,
  and the contract disclosure now matches the uniform keyed envelope.

## Remaining PR gates

1. Close this plan with `scripts/finish-task` and push the exact remediation
   head.
2. Update the PR disclosure and run final ReviewGPT round 12 concurrently with
   CI.
3. Merge only after round 12 returns `PASS` and required checks are green, then
   retire the task worktree.
Updated: 2026-07-25
Completed: 2026-07-25
