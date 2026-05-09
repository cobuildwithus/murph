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
- Patched Cloudflare runner alarm scheduling to drain the deferred idle-shutdown checkpoint before the budget retry wake, and added a targeted runner alarm regression test.

Now:
- Run focused verification, commit/push the fix, deploy immediately, and watch the lagged hosted mailbox recover.

Next:
- Verify cold/warm reply scenarios and run required final checks/audits.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: live post-deploy iMessage reply latency until the fixed worker is deployed and the lagged runner drains.

Working set (files/ids/commands):
- `apps/cloudflare/src/**`
- `packages/assistant-runtime/src/hosted-runtime/**`
- `packages/hosted-execution/src/**`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `pnpm cf:deploy:immediate`
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/user-runner-alarm.test.ts`
