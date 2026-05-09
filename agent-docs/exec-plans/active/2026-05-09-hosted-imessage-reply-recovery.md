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

Now:
- Trace current iMessage/Linq ingress, mailbox import, assistant admission, and outbound reply paths against runtime evidence.

Next:
- Patch the root cause, add targeted regressions, deploy, and verify cold/warm reply scenarios.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: exact failing production stage, pending log/data inspection.
- UNCONFIRMED: whether current dirty hosted-runner edits are intended to fix part of this issue or are unrelated in-progress work.

Working set (files/ids/commands):
- `apps/web/src/lib/hosted-onboarding/**`
- `apps/cloudflare/src/**`
- `packages/assistant-runtime/src/hosted-runtime/**`
- `packages/assistant-engine/src/assistant/**`
- `packages/hosted-execution/src/**`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `pnpm cf:deploy:immediate`
- `pnpm dev`
