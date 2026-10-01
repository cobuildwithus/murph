# Collapse device-sync wake classification

Status: completed
Created: 2026-08-30
Updated: 2026-08-30

## Goal

Resolve PR #2581's repeated same-owner wake race with one existing runtime-wake
classification contract across startup, initial mailbox fetch, and bounded
system-mailbox item execution.

Product UX effort: Patch

- Retained wearable work must continue to provider processing, terminal
  acknowledgement, and handled-through advancement when an exact same-owner
  `system_mailbox` recheck arrives at any supported startup timing.
- Explicit default or unclassified work must retain foreground preemption.

## Retrospective decision

- Original requirement: a same-owner device wake must not cause its active pass
  to yield before import, while foreground work must still preempt.
- First-reviewed shape: one runtime predicate consumed an explicit mode that had
  no production writer.
- Current shape: ReviewGPT added the existing controller-to-container writer,
  but later runtime interruption and yield gates still classify every wake as
  foreground. The same producer/consumer mechanism therefore repeats across
  phase boundaries.
- Decision: continue with the existing mode-bearing runtime signal as the one
  authority across the complete startup and bounded-item lifecycle. Exact
  `system_mailbox` notifications are same-owner scheduling context and are
  absorbed by the active pass; explicit default or unclassified notifications
  yield. Remove conflicting phase-local classification rather than adding a
  new owner, state machine, queue, persisted field, retry path, or scheduler.

## Required proof

1. Composed controller-to-container-to-runtime coverage for the same-owner wake
   before runtime readiness.
2. The same proof when the wake arrives during the initial system-lane mailbox
   fetch.
3. The same proof after import but before the selected device item executes.
4. An explicit default/unclassified wake still interrupts the initial fetch and
   preempts bounded device work.
5. Existing provider processing, terminal acknowledgement, handled-through,
   retention coalescence, and foreground-priority tests remain green.

## Authority and constraints

- ReviewGPT owns every production-code implementation hunk. The local agent may
  inspect and apply only an accepted exact artifact.
- Reuse the existing controller wake, container mode transport, coalescing
  runtime signal, mailbox import, device pass, and acknowledgement owners.
- Do not add broad resync, production mutation, provider-specific branches,
  telemetry, compatibility machinery, or unrelated refactors.

## Completion

1. Completed: recorded the retrospective on the PR.
2. Completed: ReviewGPT returned
   `device-sync-same-owner-wake-lifecycle.patch` with SHA-256
   `68341f63030f579f530c94c542fe9f6ad0d1e204787958182931383307b317bb`.
   The parent applied it byte-for-byte, then rejected it as incomplete when an
   unchanged projection-preemption test deterministically observed two calls
   instead of one.
3. Completed: ReviewGPT returned the incremental correction
   `device-sync-same-owner-wake-projection-handoff.patch` with SHA-256
   `a4a7b7c9ce40ac6f11ac42972461f5e5250b2e5b693129da361076a08112f5aa`.
   It publishes an asynchronously consumed preempting notification to the
   existing foreground observer before another projection can start.
4. Completed locally: both artifacts apply and reverse-apply cleanly; the
   rejected invariant passes unchanged; six focused runtime files pass 155/155;
   the Cloudflare controller suite passes 158/158; assistant-runtime and
   Cloudflare typechecks pass; `git diff --check` passes.
5. Remaining: push the corrected candidate and obtain a resolved final
   ReviewGPT round.
6. Remaining: admit the exact head to required CI, prove a clean current-base
   merge tree, merge, and retire the task worktree.
Completed: 2026-08-30
