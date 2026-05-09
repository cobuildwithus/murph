Goal (incl. success criteria):
- Restore hosted iMessage/Linq replies end to end.
- Success: inbound iMessage/Linq messages are durably read into hosted mailbox/import state, trigger assistant handling after cold container start, continue replying across multiple back-to-back messages, and still reply after a 30-second quiet gap.

Constraints/Assumptions:
- Treat this as a high-risk hosted runtime/external-ingress incident.
- Do not expose real contact identifiers, secrets, local account names, home paths, raw message text, or provider payloads in repo artifacts or handoff.
- Preserve unrelated dirty worktree edits and active hosted runner/runtime rows.
- Use `cf:deploy:immediate` during debugging as requested if the local state and branch policy allow it.

Key decisions:
- Start from the production evidence path: supplied exported logs, hosted-web mailbox/workflow data, Cloudflare runner observability, and Vercel logs.
- Prefer the smallest durable fix that preserves the exact-event mailbox plus staged assistant-input protocol.

State:
- Active.

Done:
- Loaded repo workflow, security, reliability, verification, hosted runtime, and Cloudflare deploy docs.
- Committed and pushed the pre-existing worktree checkpoint, then started an immediate Cloudflare deploy.
- Confirmed production mailbox high-water had advanced while the checkpointed imported sequence stayed behind for one active hosted user.
- Identified the root cause: budget-exhausted mailbox import with deferred progress scheduled a fast retry before an idle-shutdown checkpoint, so cold containers could reread the same mailbox prefix.
- Patched Cloudflare runner alarm scheduling to drain the deferred idle-shutdown checkpoint before short non-idle retry/receipt wakes, and added a targeted runner alarm regression test.
- Confirmed the first patched Worker deployed successfully and the runner began scheduling the checkpoint drain, then found a second alarm-ordering issue: if Cloudflare delivered the checkpoint alarm after the retry wake was also due, the normal drain consumed the alarm first and postponed the checkpoint again.
- Patched the Durable Object alarm consumer so an earlier due idle-shutdown checkpoint still runs before a later retry wake even when both are overdue, and tightened the regression to simulate late alarm delivery.
- Found a third live alarm race: when the due checkpoint alarm collided with an already-active invocation, recovery scheduling cleared the checkpoint and browser-vault refresh could keep preempting the durable mailbox watermark.
- Patched active-invocation recovery to preserve and defer the idle-shutdown checkpoint ahead of recovery wakes, and added a regression covering the collision plus stale-lease recovery.
- Confirmed the live reply engine is currently reaching the assistant provider but failing with `ASSISTANT_CODEX_USAGE_LIMIT`; this is separate from the mailbox/read durability fix and points at the configured OpenAI provider quota/billing boundary.
- Found a fourth live alarm risk: optional browser-vault refresh continuation could replace an earlier runner-owned checkpoint alarm when Durable Object `getAlarm()` reported no current alarm.
- Patched browser-vault refresh scheduling to read runner state and yield to earlier or due runner alarms, with a focused regression covering a due idle-shutdown checkpoint plus empty `getAlarm()`.
- After the deploy, confirmed the lagged runner still replayed from the old checkpoint and found a fifth alarm-ordering bug: a deferred idle checkpoint that was already due could lose to an already-due retry wake, and that non-idle wake cleared the checkpoint before it could commit.
- Found the Linq reply delivery failure was also being made terminal: idempotent Linq POST sends were marked non-retryable on transient 5xx/transport failures, so one provider/effect 502 could permanently fail the outbox reply.
- After the next deploy, confirmed the new Worker was live but the lagged runner still replayed 444->494/494->544 because a newly scheduled deferred checkpoint used a one-second delay while the workspace retry wake was already due; that retry wake then cleared the checkpoint before it could run.
- Patched deferred checkpoint scheduling to keep the normal fast drain, but move the checkpoint to at-or-before the retry wake when that wake is earlier/already due, and added a regression for the scheduling-time collision.
- After the deploy, confirmed the checkpoint alarm started but was preempted by foreground nudge handling while the deferred mailbox checkpoint was still in flight; the nudge also made the idle checkpoint lease look invalid, so the durable imported sequence stayed at 444.
- Patched foreground-nudge preemption and lease ownership so deferred idle-shutdown checkpoints can finish and then drain the queued nudge, with regressions for active same-isolate and persisted active checkpoint cases.
- After the deploy, confirmed mailbox import reached seq 546 in-memory but the durable imported watermark still stayed at 444 because optional browser-vault refresh alarms could fire before a pending deferred idle checkpoint and consume the alarm slot.
- Patched optional browser-vault refresh scheduling/alarm handling so stale or early optional alarms yield to pending deferred idle-shutdown checkpoints, with a regression for pending refresh plus future idle checkpoint.
- After the deploy, confirmed the idle-shutdown checkpoint now starts but does not commit: live logs show snapshot-size and Codex-home diagnostics without `checkpoint.snapshot_finished`, while the snapshot contains roughly 13k external artifacts.
- Patched idle-shutdown checkpointing to write a working delta against the existing base snapshot instead of full-compacting the whole artifact corpus on every drain, and added bridge regressions for base, working, and layered snapshot refs.

Now:
- Run broad verification, commit/push/deploy the working-delta checkpoint fix, then recheck the live mailbox high-watermark and iMessage reply path.

Next:
- Watch the lagged hosted mailbox recover, then verify cold/warm iMessage reply scenarios after provider capacity is available.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: live post-deploy iMessage reply latency until the fixed Worker is deployed, the lagged runner drains, and the assistant provider stops returning capacity/quota failure.

Working set (files/ids/commands):
- `apps/cloudflare/src/**`
- `packages/assistant-runtime/src/hosted-runtime/**`
- `packages/hosted-execution/src/**`
- `packages/operator-config/src/linq-runtime.ts`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `pnpm cf:deploy:immediate`
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/user-runner-alarm.test.ts`
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/runtime-bridge-workspace.test.ts`
- `pnpm -C apps/cloudflare typecheck`
- `pnpm typecheck`
