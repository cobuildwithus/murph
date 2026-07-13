# PR 528 hosted E2E CI repair round 2

## Goal

Restore PR 528's Cloudflare Hosted E2E gate without weakening the shutdown
checkpoint durability proof or turning test cleanup into a runtime failure.

Success criteria:

- The final cleanup follows the configured production idle-checkpoint path.
- The scenario still proves one checkpointed restore, two exact replies, two
  provider requests, zero mailbox lag, and no duplicate work.
- Focused typecheck and diff validation pass before the branch is pushed.
- ReviewGPT and CI run against the new pushed PR-specific head.

## Evidence

- Repeated test-only shutdown signals allowed the scenario's functional work to
  complete, but a follow-on container exited with code 143 and the runtime
  correctly classified that unexpected exit as `runtime_error`.
- The test-only graceful-stop control is one-shot; using it as a repeated
  quiescence mechanism races warm-container health and restart handling.
- The scenario intentionally configures a 180-second idle-checkpoint delay so
  the first explicit shutdown signal owns the checkpoint race under test.
- After the restored reply completes, production behavior is to checkpoint at
  that natural idle boundary. A 240-second bounded wait covers the configured
  delay plus operational margin without injecting another lifecycle signal.

## Approach

1. Remove repeated final shutdown signals and wait for natural quiescence for
   the configured idle-checkpoint window plus a bounded margin.
2. Keep the explicit shutdown barrier, checkpoint, exact reply/provider-count,
   zero-lag, and no-duplicate assertions unchanged.
3. Run the focused Cloudflare typecheck and required completion review.
4. Commit, push, and run ReviewGPT concurrently with the new CI head.

## Constraints

- Do not change production lifecycle behavior for a harness cleanup race.
- Do not shorten the pre-checkpoint idle delay and weaken the forced-shutdown
  proof.
- Preserve unrelated active-plan and working-tree changes.
- Do not expose secrets or direct personal identifiers in artifacts.

## State

Active.
Status: completed
Updated: 2026-07-13
Completed: 2026-07-13
