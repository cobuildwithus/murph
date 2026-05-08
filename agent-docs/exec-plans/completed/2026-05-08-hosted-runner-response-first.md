# Hosted Runner Response-First Hard Cut

## Goal

Land the response-first hosted runner invariant:

- Normal hosted assistant turns do not checkpoint the hosted workspace in the foreground.
- Normal hosted assistant turns do not build workspace snapshots or deltas.
- Reply delivery runs from live container state and returns without waiting for broad persistence.
- Browser-vault refresh runs from live warm container state as best-effort background work.
- Broad hosted workspace persistence is reserved for idle shutdown.

## Constraints

- Preserve the current checkout and unrelated dirty work.
- Do not add a compatibility mode flag for the normal hosted path.
- Treat container-death loss since the last idle checkpoint as the accepted failure model.
- Preserve deploy compatibility for old browser-vault publish/session response shapes where harmless, but do not let compatibility fields drive active correctness.

## Implementation Notes

- Disable foreground calls to `workspacePort.checkpoint` in the runner assistant path.
- Defer mailbox import, active-turn input acceptance, assistant runtime, post-assistant receipt/cleanup, and canonical-write checkpoints to idle shutdown.
- Keep local mailbox/canonical/runtime state writes.
- Preserve mailbox post-import local effects as best effort.
- Generate browser-vault replicas from the live warm vault root, not by restoring committed workspace snapshots.
- Publish browser-vault as a latest-ref derived read model: update only `browserVaultReplicaRef`, do not increment workspace version, and do not compare to `snapshotRef`.
- Keep one pending browser-vault refresh slot. Refresh schedules replace the slot with a fresh opaque slot id and timestamp, and a running refresh only clears the exact slot it consumed so a newer schedule cannot be stranded.
- Schedule refresh continuations only when refresh cannot start now or must retry; do not overwrite foreground/idle alarms after a refresh starts immediately.
- Keep source-hash browser-vault helpers as compatibility-only; active session behavior treats an existing ref as the latest available replica.

## Verification

- Focused assistant-runtime tests for the hosted workspace runner.
- Focused Cloudflare runner tests for live browser-vault refresh, pending refresh drain/retry/preemption, direct worker route scheduling, runner container refresh, runner outbound authority, and alarm behavior.
- Focused hosted web tests for latest-ref browser-vault sessions, latest-ref publish, and internal route compatibility.
- Package builds/typechecks for touched packages and apps after the code slice is stable.

## Deferred From This Slice

- Tiny Codex continuity snapshots are not introduced here; idle shutdown remains the broad recovery checkpoint.
- Deterministic provider delivery identity is left to existing outbox/provider idempotency surfaces unless later evidence shows duplicate sends after container loss.
Status: completed
Updated: 2026-05-08
Completed: 2026-05-08
