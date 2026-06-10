Goal (incl. success criteria):
- Stop duplicate assistant replies after ungraceful runner container death (2026-06-10 incident: rollout SIGTERM killed lease 174 before any snapshot; lease 175 restored a 9-minute-stale snapshot, replayed conversation seqs 186-188, and re-replied to an already-answered message).
- Fix 1 (correctness): make the hosted mailbox durably remember which conversation seqs have been fully handled, so replay after a lease restore re-stages those items as context only (no reply target), never as fresh reply candidates.
- Fix 2 (state quality): when the container receives the rollout SIGTERM while the runtime is waiting in the idle window, run the existing idle_shutdown checkpoint immediately instead of dying unsnapshotted.
- Success means: a lease restore from a stale snapshot cannot re-reply to a conversation item whose handling pass completed cleanly before the death; a SIGTERM during the idle wait produces a normal idle_shutdown checkpoint within the grace window; local (non-hosted) runtime code is untouched.

Constraints/Assumptions:
- Hosted state stays in hosted stores: the consumed watermark lives in Postgres next to the mailbox items it indexes (apps/web owns it), not in workspace files. No hosted logic enters packages/assistant-engine.
- No new queue, table, or scheduler: one column on hosted_mailbox_lane_counter, one internal ack route, one fetch-response field.
- Replay-for-context is preserved: durably-consumed items are still imported and staged (so a restored runtime regains conversation context); only their reply eligibility is removed (replyTarget: null fails the channel match in assistant-engine automation/reply.ts:1600,2073).
- Watermark advance is conservative: only at clean pass end (replyFailed === 0, no pending foreground assistant input), max laneSeq of conversation items staged for that invocation. Residual duplicate window shrinks from ~15 min (snapshot cadence) to seconds (delivery-to-pass-end), with Fix 2 shrinking the snapshot loss window for everything else.
- Ack failure is non-fatal (log + continue): watermark is monotonic max; a missed ack only widens the replay window back toward today's behavior.

Key decisions:
- Durable mark is a per-(user, lane) consumed watermark, not per-item replied flags: lanes are strictly ordered, single-consumer; one bigint column and a monotonic UPDATE ... WHERE consumed_seq < $new.
- Read side: mailbox fetch response carries consumedSeqByLane; conversation import stages items with laneSeq <= consumedSeq with replyTarget: null (context-only) instead of filtering them out.
- Fix 2 reuses the existing idle_shutdown path: container entrypoint installs a SIGTERM handler that fires a shutdown notifier; waitForHostedRuntimeDirtyWindow (packages/assistant-runtime/src/hosted-runtime.ts) treats it as the idle window elapsing now. No new checkpoint reason, no host-owned shutdown checkpoint (protocol forbids it).
- SIGTERM mid-assistant-turn is NOT handled by Fix 2 (turn may exceed grace); Fix 1 owns correctness there.

State:
- Implementation complete; verification and completion audits running.

Done:
- Prod diagnosis (hosted_runtime_log + Cloudflare observability): lease timeline, missing lease-174 snapshot, rollout SIGTERM exit 143, foreground replay with knownInputIdCount 0.
- Code map: mailbox-state/checkpoint/import, turn-input replay injection, conversation-import replyTarget construction, waitForHostedRuntimeDirtyWindow idle seam.
- Fix 2: container SIGTERM -> shutdownSignal threaded entrypoint -> invocation -> runtime; dirty wait resolves idle_checkpoint immediately; 2 entrypoint tests.
- Fix 1: consumed_seq column + migration; web store read/advance (monotonic max); fetch route returns consumedSeqByLane; consume route; contract types + parsers + route constant; cloudflare mailbox-port consume + web-control allowlist; import threads durablyConsumed (BigInt floor compare); conversation import stages replyTarget null for consumed replays; clean-pass ack in workspace runner gated on foregroundReplyFailed === 0 and no pending input, best-effort with runtime log; tests for import flagging, replyTarget suppression, ack gating/failure, shutdown signal.
- Typechecks green: assistant-runtime, cloudflare-runner, hosted-web (with prisma generate). Focused vitest green: mailbox-import, conversation-import, checkpoint, turn-input, workspace-runner (52), entrypoint shutdown tests.

Now:
- Diff-scoped owner verification (pnpm test:diff), then security-privacy-review + task-finish-review audits.

Next:
- scripts/finish-task commit + PR with deployment-order note (web before cloudflare).

Open questions (UNCONFIRMED if needed):
- Exact Cloudflare SIGTERM grace duration for runner containers (assumed >= ~10s; snapshot p50 ~4-7s). Best-effort regardless.

Working set (files/ids/commands):
- apps/web/prisma/schema.prisma + migrations/2026061000_hosted_mailbox_consumed_seq
- apps/web/src/lib/hosted-mailbox/{store,runtime-access}.ts; app/api/internal/hosted-mailbox/{fetch,consume}/route.ts
- apps/web/test/{hosted-mailbox-store,hosted-runtime-internal-routes,hosted-onboarding-privacy-foundation-migration}.test.ts
- packages/hosted-execution/src/{runtime-control,routes,parsers}.ts + parsers/runtime-control.ts
- apps/cloudflare/src/{container-entrypoint,hosted-workspace-invocation}.ts; runtime-platform/mailbox-port.ts; runner-outbound/shared-web-control-policy.ts
- packages/assistant-runtime/src/{hosted-runtime,hosted-invocation}.ts
- packages/assistant-runtime/src/hosted-runtime/{platform,mailbox-import,mailbox-conversation-import,workspace-runner,workspace-assistant-phase,maintenance,models}.ts
- packages/assistant-runtime/test/hosted-runtime-{mailbox-import,mailbox-conversation-import,workspace-runner,workspace-assistant-phase,workspace-entrypoint}.test.ts
- agent-docs/references/hosted-runtime-protocol.md
Status: completed
Updated: 2026-06-10
Completed: 2026-06-10
