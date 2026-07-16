# Hosted checkpoint foreground preemption

## Goal

Keep routine hosted workspace checkpoints behind foreground conversation work.

Success criteria:

- An exact foreground assistant scan does not synthesize a false backlog wake.
- No routine checkpoint starts before 180 seconds after the latest user message.
- Assistant wakes due inside that horizon remain pending and are serviced after
  the normal checkpoint boundary instead of advancing checkpoint publication.
- Fresh conversation input interrupts in-progress idle snapshot construction,
  fully unwinds the owned snapshot attempt, and runs before checkpoint retry.
- Shutdown-triggered and already-committing snapshot behavior stays safe.
- Focused scenario proof, owner verification, required audits, CI, and ReviewGPT
  complete with no accepted findings.

## Constraints

- Do not change inbox projection; that work is owned elsewhere.
- Do not add another scheduler, queue, or persisted state owner.
- Never race foreground mutation against snapshot work that is still running.
- Preserve snapshot session abort/cleanup and process ownership rules.
- Preserve unrelated active plans and working-tree changes.

## Approach

1. Add a failing regression for the false foreground backlog wake.
2. Gate saturation-based backlog inference to open-ended background scans.
3. Add a failing regression that a real due assistant wake stays pending without
   moving the routine checkpoint ahead of the 180-second quiet horizon.
4. Add a failing live-entrypoint regression for input arriving during archive
   construction and a bridge regression for safe snapshot-session abort.
5. Thread a cooperative, attempt-local abort signal through idle checkpoint
   construction, unwind the attempt, then service the foreground wake.
6. Update the hosted runtime protocol, run focused and owner verification,
   complete required audits, commit, open a PR, and clear CI/ReviewGPT.

## State

Implementation and local verification complete; PR review pending.

## Evidence

- Production recorded `idleCheckpointTrigger=idle_window`, not shutdown.
- A one-input foreground pass used `maxPerScan=1`; `considered=1` triggered the
  generic saturation heuristic and synthesized an already-due assistant wake.
- The runtime then selected the earlier of that wake and the 180-second idle
  deadline, starting the full snapshot immediately.
- The product invariant is now explicit: internal wake deadlines stay pending
  and must never shorten the 180-second post-user-message checkpoint horizon.
- Production configuration rejects an idle checkpoint delay below 180 seconds;
  shorter injected values remain test/local-harness controls only.
- Fresh conversation input arrived during archive construction and was not
  imported until the snapshot completed.
- Routine checkpoint archive construction, verification, session start, and
  direct upload now share a foreground-wake abort signal. Canonical publication
  remains non-cancellable, with the consumed wake retained for post-commit work.
- Focused proof covers the 179,999 ms floor, foreground wake interruption and
  retry with the latest conversation watermark, exact abort identity through
  workspace/session/artifact/presign/direct-PUT/archive boundaries, pending-wake
  retention, slow session-abort cleanup, and temporary archive cleanup.
- Assistant-runtime TypeScript 7 typecheck passed; its deterministic coverage
  lane passed 72 files and 1,615 tests (2 skipped) with 87.83% statement
  coverage. Cloudflare verification passed 103 files and 1,785 tests plus its
  TypeScript 7 and Workers-runtime checks.
- The bounded `pnpm test:diff` lane passed every global guard and typecheck, then
  reported one pre-existing contention-sensitive one-second live-wait timeout
  among 1,615 assistant-runtime tests. The exact test passed alone in 220 ms,
  its 96-test file passed alone, and the deterministic coverage lane passed the
  complete package.
- Required security/privacy review found no medium-or-higher findings. Required
  coverage-write review added the direct-PUT cancellation regression and left
  no unresolved coverage findings. Parent scope, shape, privacy, and final diff
  review found no unresolved actionable issue.
Status: completed
Updated: 2026-07-14
Completed: 2026-07-14
