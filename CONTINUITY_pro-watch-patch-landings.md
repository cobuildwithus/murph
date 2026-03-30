Goal (incl. success criteria):
- Resume this Codex session after two existing ChatGPT Pro runs, inspect their downloaded patch attachments, and land the returned changes safely with verification.

Constraints/Assumptions:
- `watch-only` mode: do not send new prompts into either ChatGPT thread unless the user later asks.
- Current requested wake delays: `40m` for `69c9f562-39bc-832a-9cf5-37e55a2ff46e` and `70m` for `69c9f7d6-e264-8329-aa6f-be0b1a18a691`.
- The repo worktree is already dirty and the coordination ledger has overlapping active lanes; any returned patch must be merged against live file state, not applied blindly.

Key decisions:
- Use a dedicated execution plan because this is delayed, multi-step, and likely to span session compaction/resume.
- Keep the coordination row narrow and update it with the exact files once each downloaded patch arrives.
- For the downloaded gateway review patch, port the intent onto the current file layout instead of applying it mechanically because some logic now lives in `packages/cli/src/gateway/snapshot.ts`.

State:
- completed_gateway_review_patch

Done:
- Read the repo routing docs needed for this flow: `AGENTS.md`, `agent-docs/index.md`, `agent-docs/PLANS.md`, and the active coordination ledger.
- Read the `work-with-pro` skill and confirmed the request maps to `watch-only`.
- Confirmed `CODEX_THREAD_ID` is present and `cobuild-review-gpt thread wake` is installed.
- Created the active execution plan for this lane.
- Confirmed the follow-up for `69c9f7d6-e264-8329-aa6f-be0b1a18a691` is now explicitly `70m`.
- Read the downloaded `murph-gateway-review-fixes.patch` attachment and mapped it to the live dirty tree.
- Confirmed the patch has not already landed; the live tree still uses raw route-key-based gateway opaque ids and does not yet reapply committed gateway snapshots during hosted recovery.
- Updated the coordination ledger row with the concrete file set for this patch.
- Implemented the gateway opaque-id hardening, token-tolerant snapshot/event matching, hosted committed-snapshot recovery, and stale-snapshot guard changes.
- Passed focused gateway and hosted-runner typechecks/tests, then passed `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage`.
- Ran the mandatory `simplify` audit subagent; it found no actionable simplifications.
- Skipped the final `task-finish-review` audit because the user explicitly instructed `dw about final finish audit`.

Now:
- Close the active plan and commit the completed patch scope.

Next:
- Wait for any remaining watched thread outputs to arrive in a later turn if needed.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: whether the second watched thread will return a separate patch that still fits under this shared execution plan.

Working set (files/ids/commands):
- `agent-docs/exec-plans/active/2026-03-30-pro-watch-patch-landings.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `CONTINUITY_pro-watch-patch-landings.md`
- `murph-gateway-review-fixes.patch`
- `apps/cloudflare/src/{execution-journal.ts,gateway-store.ts,user-runner.ts,user-runner/runner-commit-recovery.ts}`
- `apps/cloudflare/test/{runner-queue-store.test.ts,user-runner.test.ts}`
- `packages/cli/src/{gateway-core.ts,gateway/live-state.ts,gateway/opaque-ids.ts,gateway/projection.ts,gateway/snapshot.ts,gateway/send.ts}`
- `packages/cli/test/gateway-local-service.test.ts`
