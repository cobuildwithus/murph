Goal (incl. success criteria):
- Reproduce the hosted delay where fresh conversation input arrives during a system/device-sync wake and stays pending until the idle checkpoint path or a later wake.
- Fix the hosted runtime so fresh foreground conversation input observed during system/background work is promoted into assistant processing immediately.
- Success means a local end-to-end or closest production-faithful hosted runtime test fails on the current behavior, passes with the fix, and required verification/audits pass before a draft PR is opened.

Constraints/Assumptions:
- User conversation input remains the highest-priority hosted runtime work.
- Do not add a new scheduler, queue, durable state owner, or compatibility layer unless the existing runtime primitives cannot satisfy the invariant.
- Keep Temporal pointer-only and Cloudflare execution-only; this fix should stay in the assistant-runtime foreground/import/idle loop unless evidence proves otherwise.
- Preserve unrelated worktree edits and active ledger rows.

Key decisions:
- Start with a failing regression around the existing hosted runtime entrypoint/import loop rather than a helper-only unit test.
- Prefer yielding/re-entering existing foreground assistant processing when foreground work is observed during system/background work.

State:
- In progress.

Done:
- Production trace identified the delay boundary: conversation input staged quickly during `device-sync.wake`, but no provider pass started until a later foreground wake after idle shutdown began.
- Added production-faithful hosted entrypoint regressions for foreground input imported during system work and for the stale checkpoint-gated projection case.
- Accepted deep-review findings fixed: selected projected wake now carries its own checkpoint-gating bit, pending foreground assistant input now preempts system mailbox/device-sync/managed automation work before assistant admission, and skipped due device-sync wakes are re-armed when pending assistant input preempts them.
- Added a runner-gate regression proving pending foreground input does not clear checkpoint gating when a selected device-sync wake still wins.
- Fixed final stale-gate cases: post-checkpoint device-sync replacement no longer inherits an earlier assistant selection, and equal selected-wake projection merges preserve an existing checkpoint gate unless the wake is explicitly replaced.
- Explicit non-assistant wake replacements now preserve an existing checkpoint gate; assistant wake replacements can still clear it.
- Added regressions for post-checkpoint device-sync replacement, same-wake idle pass merges, and progressed replacement device-sync wakes.
- Verification passed: focused regressions, `pnpm typecheck`, `pnpm test:smoke`, `git diff --check`, and scoped `test:diff`.

Now:
- Rerun scoped verification and final read-only audits after the replacement device-sync gate fix.

Next:
- Close the plan with `scripts/finish-task`, push the branch, and open a draft PR after checks/audits pass.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- packages/assistant-runtime/src/hosted-runtime.ts
- packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts
- packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts
- packages/assistant-runtime/test/*
Status: completed
Updated: 2026-06-22
Completed: 2026-06-22
