# Hosted assistant wake pre-checkpoint service

## Goal

Serve the exact due assistant retry or follow-up wake projected directly by the
current foreground assistant phase without allowing it to advance routine
checkpoint publication ahead of the 180-second quiet horizon.

Success criteria:

- The exact current-phase projected assistant retry or follow-up can run while
  the workspace is dirty and before the routine checkpoint floor.
- No routine checkpoint starts before 180 seconds after the latest durably
  accepted conversation message.
- A progressed hot pass rearms the full quiet horizon; a no-progress pass does
  not create a busy loop or lose its wake.
- Shutdown, durable-effect, staged-follow-up, budget, and inherited, committed,
  stale, or otherwise unproven wake barriers remain checkpoint-first while the
  workspace is dirty.
- A due wake restored into a clean workspace remains ordinary foreground work.
- Focused proof, owner verification, required audits, CI, and ReviewGPT finish
  with no unresolved accepted finding.

## Constraints

- Do not change inbox projection; that work is owned elsewhere.
- Do not add a scheduler, queue, or persisted state owner.
- Preserve the foreground snapshot-preemption and abort-cleanup guarantees from
  the preceding checkpoint fix.
- Preserve unrelated active plans and working-tree changes.

## Approach

1. Add a distinct dirty-wait outcome for the exact assistant wake projected by
   the current foreground assistant phase when it becomes due before the
   checkpoint floor.
2. Route that outcome through a foreground pass without entering maintenance or
   snapshot construction.
3. Track narrow invocation-local provenance so the exact wake can be presented
   once per dirty checkpoint generation, while no-progress and replacement
   outcomes preserve the correct pending wake.
4. Keep durable effects, staged follow-ups, shutdown, budget exhaustion, and
   inherited, committed, stale, or otherwise unproven wake keys
   checkpoint-first while dirty; keep clean/restored wakes ordinary.
5. Add timer, no-drop, and loop-prevention regressions, then rerun the affected
   owner suites, audits, CI, and ReviewGPT on the pushed head.

## ReviewGPT accepted findings

Round 1 returned three accepted findings whose remediation is implemented:

1. Interrupted legacy skipped-inline materialization must stage outside the
   live workspace tree and install atomically before its manifest is cleared,
   so a wake cannot expose a partially migrated prefix or resurrect a deletion.
2. Additional accepted messages from the initial mailbox batch must remain in
   the foreground rerun path instead of becoming immediate assistant wakes that
   wait for the checkpoint floor. A selected retryable failure must not spin.
3. The existing wake abort signal must reach recursive archive planning and
   selected-entry metadata preflight and postflight scans, with checks around
   awaited filesystem work, so foreground input can interrupt those walks.

Focused owner tests now cover each finding. Final package verification,
specialist audits, CI, and the ReviewGPT correction round remain.

## Review remediation retrospective

The immutable first-reviewed authored-source shape was +467/-162. At the
remediation checkpoint, the PR's authored-source shape was +986/-228, including
+523/-70 since the first-reviewed head. That crossed the ReviewGPT remediation
growth trigger and increased source additions by more than 25 percent.

The growth remains one ownership correction rather than a new architecture:
the runtime decouples a runnable foreground wake from snapshot publication,
stages legacy migration bytes under the existing scratch owner, carries an
accepted initial-input remainder through the existing foreground rerun batch,
and threads the existing abort signal through real traversal boundaries. It
adds no durable owner, queue, scheduler, state machine, lease, or reconciliation
loop. An initial +295-line legacy rollback draft was rejected and reduced to
+142/-27 by relying on the existing canonical lock and attempt-owned paths.

Decision: continue this PR. Splitting the corrections would knowingly leave a
production path that violates the same foreground-priority invariant. Further
material source growth requires another architecture pressure check. The same
decision is recorded on PR #636 and will be carried into correction-round
metadata.

## Evidence

The current hot-wake implementation has green local proof:

- Typecheck passed.
- The focused hot-wake matrix passed 14 tests.
- The full hosted runtime workspace-entrypoint suite passed 210 tests.
- Independent adversarial review reported no hot-wake finding.
- `git diff --check` was clean at the hot-wake implementation checkpoint.

## State

The hot-wake implementation and the three accepted ReviewGPT remediations are
implemented with focused proof. The task remains active while the final owner
verification, specialist audits, base update, CI, and ReviewGPT correction
round run.

Status: active
Updated: 2026-07-14
