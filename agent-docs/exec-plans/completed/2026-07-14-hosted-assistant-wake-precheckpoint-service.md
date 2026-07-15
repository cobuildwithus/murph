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
6. Keep foreground interruption responsive while snapshot cleanup holds runtime
   locks by threading the existing checkpoint abort signal through recursive
   symlink pruning, write-operation pruning, pending-input compaction, and
   assistant-runtime residue inventory and deletion loops.

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

Focused owner tests now cover each finding. The required coverage-write audit
passed with zero findings and no edits. The candidate head's complete required
CI matrix also passed, including checkpoint durability and the corrected
onboarding-follow-up lane. The ReviewGPT correction round will certify the
exact final plan-close head alongside its fresh CI run.

## Post-merge integration finding

The final integration review found one additional foreground-priority gap:
pre-snapshot cleanup held the canonical lock and, for pending-input and residue
work, the assistant-runtime lock while potentially unbounded filesystem and
record scans ignored the already-existing foreground abort signal. The runtime
did not begin the fresh foreground pass until the checkpoint promise unwound,
so a wake arriving mid-cleanup could still be delayed by the rest of those
walks.

The accepted correction cooperatively threads the checkpoint signal through
each cleanup owner and checks it around awaited filesystem work and between
records. The assistant-state write-lock queue itself becomes cancellable so an
aborted checkpoint does not wait behind an earlier writer, and recursive stage
deletion becomes an explicit per-entry walk so one native `rm` cannot retain
the canonical lock for an unbounded tree. It deliberately does not use
`Promise.race`, which would release locks while abandoned cleanup continued
touching live state. Focused tests prove exact abort-reason propagation, queue
ordering after a canceled waiter, symlink-safe bounded deletion, and that work
after the interruption is not visited. The final ReviewGPT correction round
will cover this additional delta.

This additional source growth triggered the plan's architecture pressure
check. Skipping terminal and assistant-residue cleanup would silently disable
the only production pruning path, including privacy-retention cleanup; racing
the work would abandon mutations; and adding a scheduler or cleanup owner would
expand state and lifecycle complexity. The smallest durable correction keeps
the existing owners and locks, adds one optional signal to the existing lock
queue, and makes the existing recursive deletion finite and cooperative.

## Review remediation retrospective

The immutable first-reviewed authored-source shape was +467/-162. The final
pre-close implementation shape is +1,352/-300. This crossed the ReviewGPT
remediation growth trigger and increased source additions by 189.5 percent.

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

The implementation and its integration corrections have green proof:

- The focused hot-wake matrix passed 14 tests, and the full hosted-runtime
  workspace-entrypoint suite passed 210 tests.
- The full workspace-runner suite passed 98 tests; the focused legacy
  materialization suites passed 30 tests.
- Runtime-state passed 175 tests, Cloudflare snapshot suites passed 17 tests,
  and the assistant bridge suite passed 28 tests.
- Assistant-runtime coverage passed 72 files / 1,615 tests at 87.83 percent
  statement coverage. Cloudflare verification passed 103 files / 1,785 tests
  plus its Workers-runtime checks.
- The required coverage-write audit passed with zero findings and no edits;
  tests cover the floor/hot-wake matrix, checkpoint-first barriers, pre-CAS
  interruption, accepted initial-batch remainder, atomic legacy migration, and
  real archive, preflight, cleanup, lock-wait, and recursive-delete cancellation
  seams.
- The final shared-host diff lane passed dependency and workspace guards,
  affected-package TypeScript checks, every affected package test suite, built
  package-boundary checks, generated-artifact preparation, Prisma generation,
  and the web TypeScript 7 check. Once it reached the duplicate web Vitest
  stage, the exact owned command was stopped with Ctrl-C because its base had
  advanced and the candidate head's complete GitHub app-verification lane was
  already green. Fresh CI will exercise the rebased final head.
- The complete candidate CI matrix passed: Linux and macOS host matrices,
  release build/typecheck, app verification, package coverage, runner/web
  bundle assembly, every hosted E2E shard, checkpoint durability, and the
  onboarding-follow-up shard.
- The Linux runner assembly proved the entry ratchet on the candidate base. The
  entry baseline preserves its 48,000-byte host tolerance and the independent
  static-closure and total ceilings.
- The onboarding E2E now follows the deterministic managed reconciler introduced
  on `main`; this branch removes its final obsolete scripted expectation/import
  and corrects the testing map instead of restoring a scenario-specific
  checkpoint override.
- Docs gardening and full branch-range docs drift passed. The docs checks will
  run once more after this plan is archived.
- The branch was rebased normally onto the latest `main`; range-diff marked all
  ten PR commits patch-identical, and the required ReviewGPT prompt commit
  remains in history.

## State

The hot-wake implementation, all three accepted ReviewGPT remediations, the
cleanup-cancellation correction, and the current-main CI fixture and bundle
ratchets are implemented with focused and candidate-head proof. The local task
plan is complete. The exact archived-plan head will be pushed for fresh CI and
the required ReviewGPT correction round before PR #636 is marked ready or
merged.

Status: completed
Updated: 2026-07-14
Completed: 2026-07-14
