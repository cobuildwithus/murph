# Goal (incl. success criteria):
- Land the watched `assistant-target-area-review-fixes.patch` semantics on the current assistant-target implementation.
- Success means session option updates preserve target-only provider fields from the persisted target, resume matching requires an exact stored `resumeRouteId`, focused assistant-engine regressions cover both fixes, and the repo-required scoped verification/audit flow passes or any unrelated blocker is called out explicitly.

# Constraints/Assumptions:
- Preserve unrelated dirty worktree edits, especially the active `packages/messaging-ingress/**` changes.
- Treat the downloaded patch as intent, not overwrite authority; adapt it to current tests and mocks instead of replaying the patch literally.
- Keep the change scoped to the touched assistant-engine seam plus direct regression proof.

# Key decisions:
- Reuse the existing assistant-engine unit suites instead of adding a new patch-shaped test file.
- Merge session option edits from the persisted target contract because `providerOptions` is only a derived projection and omits target-only codex fields.
- Hard-cut resume matching to exact `resumeRouteId === routeId` because the minimal persisted resume state no longer carries enough identity to guess safe cross-route reuse.

# State:
- completed

# Done:
- Read the required routing, verification, completion, and `work-with-pro` skill docs for this wake flow.
- Inspected the exported thread JSON and the downloaded review patch.
- Confirmed the production hunks are still needed on current `main`.
- Landed the assistant-engine production changes and updated focused regressions in `assistant-local-service-runtime.test.ts` and `provider-seams.test.ts`.
- Ran `pnpm --dir packages/assistant-engine test:coverage` successfully.
- Ran a direct `pnpm exec tsx --eval ...` scenario proof confirming persisted Codex command retention plus exact-route resume matching.
- Completed the required `coverage-write` and `task-finish-review` audit passes with no actionable findings.
- Sent the same-thread follow-up review request and confirmed the new `repo.repomix(93).xml` / `repo.snapshot(97).zip` user turn in the exported thread after the browser commit-timeout path.
- Armed the detached recursive wake hop at `output-packages/chatgpt-watch/69daf1be-3040-839b-9dfe-a39d68707a68-2026-04-12T023642Z/` and verified the wake process is running.

# Now:
- Close the plan with `scripts/finish-task` and create the scoped commit for this assistant-engine slice.

# Next:
- No further implementation steps in this wake lane unless the next recursive wake returns another applicable patch.

# Open questions (UNCONFIRMED if needed):
- UNCONFIRMED whether the optional higher-boundary provider-turn integration proof suggested by final review is worth adding in a later pass; current seam tests plus direct scenario proof are sufficient for this wake landing.

# Working set (files/ids/commands):
- Files: `packages/assistant-engine/src/assistant/{local-service.ts,provider-binding.ts}`, `packages/assistant-engine/test/{assistant-local-service-runtime.test.ts,provider-seams.test.ts}`, this plan, and `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`.
- Artifacts: `output-packages/chatgpt-watch/69daf1be-3040-839b-9dfe-a39d68707a68-2026-04-12T015704Z/thread.json`, `output-packages/chatgpt-watch/69daf1be-3040-839b-9dfe-a39d68707a68-2026-04-12T015704Z/downloads/assistant-target-area-review-fixes.patch`.
- Commands: focused reads with `sed`/`rg`, verification via `pnpm typecheck`, `pnpm test:diff packages/assistant-engine`, required audit passes, then `pnpm review:gpt --send ...` and the detached `cobuild-review-gpt thread wake ...` follow-up.
Status: completed
Updated: 2026-04-12
Completed: 2026-04-12
