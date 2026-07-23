# PR 857 welcome-session durability remediation

Status: completed
Created: 2026-07-23
Updated: 2026-07-23

## Goal

- Ensure the first provider-backed user-action turn on a direct conversation is durably checkpointed before provider execution even when a deterministic welcome created the session earlier.

## Success criteria

- A welcome-created attended direct session emits the existing pre-provider checkpoint signal on its first accepted user action.
- A newly created direct user-action session retains the same behavior.
- A direct session already present in the restored published snapshot does not add another pre-provider checkpoint or stop the foreground watcher.
- Output-only notification turns remain exempt.
- Checkpoint rejection still prevents provider and phone-port execution while watcher and detached-work owners resume.
- Focused tests, typechecks, canonical diff verification, canonical acceptance, exact-head CI, and final ReviewGPT pass.

## Scope

- In scope: emit the direct user-action session identity from the Engine; derive checkpoint need from the sessions present in the restored durable snapshot; route only absent sessions through the existing runner-owned `idle_shutdown` checkpoint; add focused Engine/Runtime regression coverage; update current protocol/PR documentation.
- Out of scope: new persisted flags, session schema changes, new snapshot reasons, phone-port checkpoint wrappers, notification-time checkpoints, queues, or reconciliation machinery.

## Constraints

- Technical constraints: preserve the round-4 quiescent owner, exact-origin routing, causal ordering, and output-only notification exemption; malformed restored session files must remain untouched and must not count as durable session evidence.
- Product/process constraints: smallest owner-bound fix; immutable first-review baseline; rerun ReviewGPT only on the exact pushed remediation head alongside CI.

## Risks and mitigations

1. Risk: every established direct turn stops and restarts the foreground watcher even when no checkpoint is needed.
   Mitigation: test restored-session membership before entering the watcher-stop boundary; established sessions remain an O(1) no-op.
2. Risk: an in-memory session is mistaken for durably restored state when no snapshot exists.
   Mitigation: preload session IDs only when the restored workspace has a published snapshot reference; otherwise begin with an empty durable-session set.
3. Risk: a checkpoint failure incorrectly marks the session durable.
   Mitigation: add the session ID only after snapshot publication and workspace rebase succeed; retain fail-closed provider ordering tests.

## Tasks

1. [x] Add focused regressions for a welcome-created direct session and an output-only notification.
2. [x] Snapshot valid restored session IDs once at runtime restore and make established-session checks an O(1) no-op before watcher shutdown.
3. [x] Replace `resolved.created` eligibility with direct-user-action session signaling while preserving current accepted-input and audience guards.
4. [x] Prove the production snapshot boundary, restored-session no-op, checkpoint rejection, watcher quiescence, detached-work resumption, and non-mutating invalid-session handling.
5. [x] Run canonical local gates and prepare the exact-head PR/CI/ReviewGPT handoff.

## Decisions

- Confirmed finding: deterministic exact welcome creates and persists the attended direct session, and the next user reply resolves it with `created: false`; the current hook therefore skips the pre-provider snapshot.
- Use valid session IDs physically present after restoring the published workspace snapshot as the source of truth. Read them without invoking the ordinary repairing/quarantine list path so malformed legacy files remain untouched and cannot suppress the checkpoint. This is exact for crash recovery, avoids a new persisted flag, and handles sessions created by any output-only turn after restore.

## Evidence

- Focused Assistant Engine local-service suite: 96 tests passed with the package's documented 6 GiB heap ceiling.
- Focused Assistant Engine store-persistence suite: 22 tests passed.
- Focused Runtime workspace-runner suite: 108 tests passed.
- Full Runtime workspace-entrypoint suite: 241 tests passed.
- Assistant Engine and Runtime package typechecks passed.
- `pnpm docs:drift` and `git diff --check` passed.
- Canonical Crabbox `pnpm test:diff` proved all affected owner and reverse-dependent typechecks plus Assistant Engine (2,614 passed, 5 skipped) and Assistant Runtime (1,819 passed, 2 skipped) suites. Its later untouched CLI tail reproduced the pre-existing 60-second subprocess timeout pattern already recorded on PR 857, so the owned remote run was stopped after the changed surfaces were green.
- Canonical Crabbox `pnpm verify:acceptance` passed in Blacksmith Testbox `tbx_01ky6vqxj5ym16etg53g2xm611`, including full package coverage, the Web production build, Cloudflare Node tests (1,873 passed), and Workers tests.
- Exact-head CI and ReviewGPT remain the external PR-loop gates after plan closure and push, as required by the completion workflow.

## Verification

- Commands: Assistant Engine focused journal/local-service/notification suites and typecheck; affected Runtime suites and typecheck; `pnpm test:diff` for exact changed paths; `pnpm verify:acceptance`; GitHub CI; exact-head ReviewGPT.
- Expected outcomes: all checks pass, ReviewGPT returns `ROUND_OUTCOME: PASS`, GitHub reports `MERGEABLE` and `CLEAN`, and the worktree is clean.
Completed: 2026-07-23
Completed: 2026-07-23
