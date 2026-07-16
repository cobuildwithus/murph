Goal (incl. success criteria):
- Diagnose and fix hosted iMessage reply latency without adding a new broad foreground persistence system.
- Success means an inbound iMessage-triggered hosted assistant turn shows quick typing/reply behavior on cold container start, warm container reuse, and warm multi-message state-mutating turns.
- Keep the hosted-runner minimal architecture migration guide invariants: foreground turns do not build/checkpoint workspace snapshots; browser-vault and tiny Codex continuity are background-only; idle shutdown is the only broad checkpoint producer.

Constraints/Assumptions:
- Preserve unrelated dirty worktree edits and active hosted-runtime rows.
- Do not expose local account names, home paths, message contents, provider payloads, mailbox ids, secrets, prompts, transcripts, vault contents, or raw logs in docs, tests, commits, or handoff.
- Use metadata/timing evidence from local runtime, DB, and Cloudflare surfaces where available; avoid printing sensitive payloads.
- Root-cause latency before changing architecture. If the fix requires a larger architecture decision or becomes unclear, use the Work With Pro path rather than landing a bandaid.
- Prefer deleting or bypassing foreground complexity over introducing new queues, journals, CAS gates, or path-scoped checkpoint machinery.

Key decisions:
- Treat the migration guide as the governing plan for this latency task.
- Foreground response latency is optimized ahead of dashboard freshness, Codex continuity completeness, and pre-idle crash persistence.
- Deterministic delivery identity is the acceptable duplicate-send mitigation for foreground no-checkpoint behavior, subject to provider support.

State:
- Production includes the warm-restore, mailbox-lag, runner preemption, foreground nudge handoff, active-turn refresh, replay-window, live-restore, and refresh-container churn fixes through commit `e6881ee5e`.
- Live iMessage cold, hot, and multi-message acceptance probes were sent after explicit approval. The user-visible reply path is now fast enough for acceptance.
- Production database follow-up confirmed the checked slow-looking rows did not take the 30s active-turn deferred-retry path. Redacted assistant automation detail rows are buffered without original event timestamps and receive their `at` value when persisted after the assistant pass, so they can exaggerate reply-start latency when used as the sole timing source.

Done:
- Created the task goal.
- Read the repo routing docs, verification/security/reliability docs, hosted runtime protocol, and hosted-runner minimal architecture migration guide.
- Confirmed the worktree already contains overlapping hosted-runtime, Cloudflare, web, assistant-runtime, and assistant-engine edits; preserve them.
- Sent local iMessage latency probes and correlated UI timing with DB/Cloudflare metadata.
- Confirmed provider send effects are not the dominant delay once generation runs; observed delayed/repeated foreground mailbox import and repeated same-window replay.
- Identified root cause: warm foreground restores could clear the hot restore cache marker after a verified hit, then restore the same hot snapshot on the next invocation and wipe local hot runtime state, including deferred mailbox watermarks. This made foreground no-checkpoint behavior satisfy the migration invariant but lose warm local progress.
- Implemented the smallest fix: keep/write the hot restore cache marker after a verified or applied hot layer so warm foreground invocations preserve live local state while cold containers still restore/replay from durable workspace/mailbox state.
- Added focused coverage proving deferred mailbox watermarks survive warm foreground restores without workspace checkpointing or repeated artifact fetches.
- Focused verification passed for assistant-runtime hosted workspace entrypoint tests, assistant-runtime typecheck, and Cloudflare runner typecheck.
- Found the remaining live replay shape: an older `base + delta` working snapshot bypassed the base/hot restore caches, so each foreground invocation re-applied the same delta and reset deferred mailbox watermarks.
- Added a local working-snapshot restore marker for unchanged legacy `base + delta` snapshots. This keeps warm foreground state local, does not checkpoint snapshots in the foreground, and preserves cold restore correctness.
- Verified `pnpm --filter @murphai/assistant-runtime test -- hosted-runtime-workspace-entrypoint.test.ts`, `pnpm --filter @murphai/assistant-runtime typecheck`, `pnpm --dir apps/cloudflare typecheck`, and `pnpm typecheck`.
- DB/Cloudflare evidence showed the remaining production delay was a repeated runner nudge/alarm loop: foreground mailbox imports were intentionally checkpoint-deferred, but the mailbox lag sweeper still compared mailbox high-water rows only to checkpointed workspace status.
- Implemented the smallest web-side fix: mailbox lag status now merges the latest `mailbox.imported` runtime-log sequence watermarks with checkpointed workspace status, and the sweeper uses that same helper before deciding to nudge. This avoids adding new persistence, foreground checkpoints, or a new queue.
- Focused verification passed for `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-mailbox-lag-sweeper.test.ts apps/web/test/hosted-runtime-internal-routes.test.ts`.
- Deployed commit `a00a53bd8` to production through GitHub Actions; production script version observed as `f640d327-fc58-4c54-9eff-56f6de37d176`.
- Ran a new local iMessage probe after deployment. DB/Cloudflare metadata showed mailbox append to direct runner nudge was roughly one second, but the runner lane repeatedly logged active-invocation recovery for a lower-priority alarm invocation after a container rollout, delaying foreground work until the active lane cleared.
- Implemented lower-priority invocation preemption: foreground nudges abort active `alarm`, `retry`, or `idle_shutdown_checkpoint` container invocations, destroy the preempted container best-effort, clear the runner lane as an intentional handoff, and immediately let the pending nudge drive. Active `nudge`/manual foreground turns are not interrupted.
- Focused Cloudflare verification passed for `pnpm --filter @murphai/cloudflare-runner typecheck` and `pnpm --filter @murphai/cloudflare-runner test -- user-runner-alarm.test.ts --runInBand`.
- Added persisted lower-priority invocation preemption for the cross-isolate case where a foreground nudge sees only `runner_meta.in_flight`, destroys the old runner container, clears the matching persisted active invocation, and starts the pending nudge immediately.
- Focused Cloudflare verification passed for `pnpm --filter @murphai/cloudflare-runner test -- user-runner-alarm.test.ts --runInBand`.
- Required `pnpm typecheck` passed after preserving and type-fixing an unrelated dirty hosted-local harness test signature.
- Required `pnpm test` remains blocked by the pre-existing contracts scheduled-log assertion mismatch (`schedule.expression is required.` vs the generic string-minimum message), before reaching the Cloudflare test phase.
- Deployed commit `47868ba77` to production through GitHub Actions; production script version observed as `f3d83920-5b1b-497e-983a-a118f692755f`.
- Ran a new local iMessage probe after deployment. DB/Cloudflare metadata showed the inbound message appended quickly and runner nudges were accepted, but no later assistant import/reply was observed while an active foreground turn remained in progress.
- Identified the remaining root cause: `runHostedWorkspaceAssistantPhase` disabled active-turn mailbox refresh whenever the initial foreground import was fresh. That preserved the first-admission duplicate-import guard, but it also disabled the 1s live active-turn mailbox poll, causing follow-up messages to wait behind the provider turn.
- Implemented the minimal runtime fix: keep `skipInitialMailboxRefresh` for fresh foreground imports, but pass `skipActiveTurnMailboxRefresh: false` so active provider turns can import late conversation input without building/checkpointing foreground workspace snapshots.
- Focused assistant-runtime verification passed for `pnpm --filter @murphai/assistant-runtime test -- hosted-runtime-turn-input.test.ts hosted-runtime-workspace-assistant-phase.test.ts --runInBand`.
- Confirmed after the latest deployed fixes that repeated foreground turns still imported/reconsidered the same 22 deferred conversation items from workspace version 1786; assistant pass elapsed around 17s while the Codex provider turn was roughly 3-6s.
- Implemented the minimal replay-window fix: fresh foreground imports pass only the latest bounded replay ids as preferred/foreground replay ids, and the turn input source reserves scan slots for replay candidates before filling remaining capacity with older base context.
- Focused assistant-runtime verification passed for `pnpm --filter @murphai/assistant-runtime test -- hosted-runtime-turn-input.test.ts hosted-runtime-workspace-assistant-phase.test.ts --runInBand` and `pnpm --filter @murphai/assistant-runtime typecheck`.
- Final completion review found the assistant pass could still request an unbounded foreground replay scan. Fixed by bounding `maxPerScan` to the replay-window size and adding a maintenance-level regression for the hosted assistant pass call.
- Updated focused assistant-runtime verification passed for `pnpm --filter @murphai/assistant-runtime test -- hosted-runtime-maintenance.test.ts hosted-runtime-turn-input.test.ts hosted-runtime-workspace-assistant-phase.test.ts hosted-runtime-workspace-entrypoint.test.ts --runInBand` and `pnpm --filter @murphai/assistant-runtime typecheck`.
- Required `pnpm typecheck` passed after the maintenance-level fix. Required `pnpm test` is still blocked before this package by the pre-existing contracts scheduled-log assertion mismatch.
- Required completion audits passed after the maintenance-level fix: security/privacy found no findings, coverage-write made no changes, and final review confirmed the previous unbounded replay-scan finding is closed.
- Preferred diff verification passed: `pnpm test:diff packages/assistant-runtime/src/hosted-runtime/maintenance.ts packages/assistant-runtime/src/hosted-runtime/turn-input.ts packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts packages/assistant-runtime/test/hosted-runtime-maintenance.test.ts packages/assistant-runtime/test/hosted-runtime-turn-input.test.ts packages/assistant-runtime/test/hosted-runtime-workspace-assistant-phase.test.ts`.
- Sent local iMessage cold, hot, and multi-message probes after the latest deploy. Production database inspection confirmed no `input.reply-skipped`/30s deferred active-turn retry path for the checked probes; the visible reply path is currently fast.
- Confirmed redacted automation detail runtime logs are persisted from buffered entries without event-time fields, so DB row timestamps for detail labels such as reply-start can reflect post-pass log-write time.

Now:
- Accepted. Close this plan with the repo finish-task workflow.

Next:
- None for this plan. Reopen a new investigation only if visible reply latency regresses.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: whether provider-side iMessage delivery supports true deterministic idempotency, or only local warm-container sent markers.

Working set (files/ids/commands):
- `hosted-runner-minimal-architecture-migration-guide.md`
- `agent-docs/references/hosted-runtime-protocol.md`
- `packages/assistant-runtime/src/hosted-runtime.ts`
- `packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts`
- `packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts`
- `packages/assistant-runtime/src/hosted-runtime/callbacks.ts`
- `apps/cloudflare/src/user-runner.ts`
- `apps/cloudflare/src/runtime-bridge-workspace.ts`
- `apps/cloudflare/src/node-runner.ts`
- `apps/cloudflare/src/runner-container.ts`
- `apps/web/src/lib/hosted-onboarding/**`
- `apps/web/src/lib/hosted-runner/**`
- `apps/web/src/lib/hosted-mailbox/lag.ts`
- `apps/web/src/lib/hosted-mailbox/lag-sweeper.ts`
- `apps/web/app/api/internal/hosted-runtime/status/route.ts`
- `apps/web/src/lib/browser-vault/**`
- Focused hosted-runtime, hosted-local, Cloudflare runner, and web ingress tests as identified during investigation.
- Latest scoped verification: `pnpm --dir apps/cloudflare typecheck`; `pnpm --dir . exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/user-runner-alarm.test.ts apps/cloudflare/test/runner-container.test.ts`; `pnpm test:diff apps/cloudflare/src/user-runner.ts apps/cloudflare/src/runner-container.ts apps/cloudflare/test/user-runner-alarm.test.ts apps/cloudflare/test/runner-container.test.ts`.
- Latest deploy: GitHub Actions run `25591346257`, head SHA `e6881ee5eea41f226ce004f701a8d69b70c7ffca`, status `success`.
Status: completed
Updated: 2026-05-09
Completed: 2026-05-09
