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

Now:
- Run required verification, commit/push the browser-vault alarm ordering fix, deploy immediately, and watch the lagged hosted mailbox recover.

Next:
- Verify cold/warm reply scenarios after provider capacity is available and run required final checks/audits.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: live post-deploy iMessage reply latency until the fixed Worker is deployed, the lagged runner drains, and the assistant provider stops returning capacity/quota failure.

Working set (files/ids/commands):
- `apps/cloudflare/src/**`
- `packages/assistant-runtime/src/hosted-runtime/**`
- `packages/hosted-execution/src/**`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `pnpm cf:deploy:immediate`
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/user-runner-alarm.test.ts`
