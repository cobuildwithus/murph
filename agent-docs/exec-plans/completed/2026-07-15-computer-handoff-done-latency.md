# Computer handoff Done latency

Status: completed
Created: 2026-07-15

## Goal

Return members from a completed live-browser login handoff to their existing
Murph conversation without waiting for a new Kernel browser to start.

## Evidence

- The latest production login handoff spent about 10.1 seconds inside the Done
  request before its completion row committed.
- Recent non-login handoffs committed in roughly 20–60 milliseconds.
- The login-only path synchronously stops the current browser so Kernel saves
  its profile, starts a replacement browser from that profile, publishes the
  replacement, and only then returns the conversation redirect.

## Invariants

- A completed login must be checkpointed to the member's existing Kernel
  profile before the assistant regains browser control.
- The run remains `awaiting_user` until a newer authorized conversation item
  proves resume authority.
- Only one browser may write the member profile at a time.
- Failed checkpoint/reopen work remains retryable without asking the member to
  repeat a successful login.
- Handoff tokens, browser capabilities, profile names, and member identifiers
  never enter logs or user-facing diagnostics.

## Approach

1. Make the Done request durably mark the live-view handoff complete while the
   existing browser remains the sole profile writer.
2. Move the existing stop/save/reopen checkpoint into the later authorized
   resume path, before the run transitions back to `running`.
3. Cover both `computer_start_run` and `computer_open` resume paths, including a
   retry after replacement-browser creation fails.
4. Update the hosted computer-use owner documentation and run the required web
   verification, direct scenario proof, specialist audits, and PR review gate.

## Progress

- Production timing and the synchronous login-only call path have been proven.
- Done now commits the handoff without Kernel work; both authorized resume
  paths checkpoint and replace the browser before returning assistant control.
- Focused handoff tests, web typecheck, the production build, lint, and the full
  web test suite pass. The isolated web smoke also passes after the first broad
  run timed out under concurrent build/test load.
- Frontend review returned zero findings. Coverage review added direct Prisma
  CAS proof for completed-handoff browser clear and replacement.
- Final diff verification and the PR-lane ReviewGPT gate are pending.
Updated: 2026-07-15
Completed: 2026-07-15
