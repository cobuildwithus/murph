# Keep vault sharing independent of foreground replies

Status: completed
Created: 2026-09-23
Updated: 2026-09-23

## Outcome and ownership

Incoming conversation work must proceed while a vault-share projection finishes.
One invocation-owned projection reads an isolated committed checkpoint, performs
capture in a worker thread, and publishes through the existing Web grant and
workspace-version fences. Conversation wakes neither cancel nor drain that task.
The existing invocation release still drains owned work; shutdown and lost
authority prevent new effects. No new scheduler, table, queue, or retry owner.

## Evidence and correction

The existing capture reads the live vault and completes before inspecting queued
wakes. Removing that wait alone would mix mutable generations. Reuse the existing
snapshot restore port for an isolated scratch read view and retain the current
projection promise across foreground work. A dedicated trusted capture thread
keeps synchronous query work off the foreground event loop. Keep at most one
projection per invocation. Clean the read view after the thread exits.

## Product UX

Outcome: messages start without waiting for shared-data capture.
Reaches: personal conversation arrivals during scope lookup, restore, capture,
and publication; ordinary completion, revocation, stale version, and shutdown.
Proof: gate background work and prove foreground admission before release; prove
capture reads committed data, retains its work, and removes its scratch files.
No prompt, tool, model, or reply-policy change.

## Verification and tasks

- [x] Prove isolated capture and uninterrupted foreground progress.
- [x] Preserve finite publication, access/version fencing, and shutdown ownership.
- [x] Run relevant runtime and restore tests, typechecks, and complexity guard.
- [x] Update durable architecture and reliability owners, review diff, and commit.

## Deployment

Internal runtime/adapter change; no persisted or HTTP schema change. Old runners
retain old scheduling. Revert restores the former behavior without data migration.
Production improvement requires deployed-image and natural-latency observation.

## Local evidence and review

Product UX: Ready for local implementation. Incoming conversations proceed while
scope lookup, checkpoint restore, or delivery is pending; empty wakes retain
useful work. Existing invocation release drains the task, shutdown prevents new
scopes, failed scopes retain recovery, and only one projection runs at a time.
The actual worker test publishes the saved name despite a concurrent live-vault
change. Failed and interrupted restores publish nothing and remove scratch.

Validation: focused runtime projection, foreground entrypoint, system preemption,
and convergence suites; snapshot restore preparation tests; assistant-runtime
TypeScript build and Cloudflare typecheck. Complexity guard passes with lower
runtime branching debt. Privacy and full diff review completed. The new scope-lookup foreground test
fails against the original runtime because it cancels the pending projection,
confirming regression coverage. No dependency,
queue, scheduler, database migration, prompt, or model-policy change.

Tradeoff: active sharing adds one background download/extraction of the committed
snapshot and one capture worker. It shares host CPU/I/O capacity; the contract is
no awaited projection on incoming conversation handoff, not dedicated hardware.

Changelog: member-visible performance improvement; publish an entry with the
source PR when this local change enters the PR workflow. Proposed copy: “Murph
can start answering new messages while shared group data updates in the
background. Sharing continues without restarting when a new message arrives.”

Delivery boundary: scoped local commit only. No push, PR, external ReviewGPT,
CI, deployment, or production latency confirmation is claimed. PR publication
requires the repository's final concurrency review and exact-head CI gates.
Completed: 2026-09-23
