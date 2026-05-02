Goal (incl. success criteria):
- Land the supplied hosted ingress robustness patch intent.
- Provider-facing Linq/Telegram/email ingress should not fail after a durable mailbox append solely because the post-commit runner nudge workflow failed to start.
- Bound Linq webhook body reads and hosted email metadata fields before append.
- Add focused tests for the new post-commit best-effort semantics.

Constraints/Assumptions:
- Preserve unrelated dirty work in the current checkout.
- Supplied patch file is behavioral intent; it is not mechanically applyable as-is.
- No DB-backed pending-handoff reconciler in this slice.
- If durable architecture docs still describe provider errors after post-append workflow-start failure, update them with the new current behavior and residual reconciliation gap.

Key decisions:
- Treat post-append workflow start as best-effort and log/return structured status instead of throwing to provider ingress.
- Use bounded request/metadata parsing at ingress boundaries.
- Use current checkout only; no separate worktree.

State:
- Active.

Done:
- Read required routing, verification, security, reliability, and testing docs.
- Confirmed supplied patch is corrupt for `git apply`.
- Added bounded Linq webhook raw-body read scaffolding; current follow-up adjusts the cap to 256 KiB and adds Linq message-parts payload bounds.

Now:
- Add focused Linq request-body and pre-mailbox message-parts limits on top of current files.

Next:
- Run focused verification, required audits, typecheck/tests as feasible, then commit via repo helper.

Open questions (UNCONFIRMED if needed):
- Full durable pending-handoff reconciler remains a follow-up hardening step, not part of this patch.

Working set (files/ids/commands):
- `apps/web/src/lib/hosted-onboarding/webhook-service-wake.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-service.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts`
- `apps/web/app/api/hosted-onboarding/linq/webhook/route.ts`
- `apps/cloudflare/src/hosted-email/worker-ingress.ts`
- `apps/cloudflare/src/index.ts`
- `packages/hosted-execution/src/email-ingress.ts`
- `packages/assistant-runtime/src/hosted-runtime/mailbox-import.ts`
- Focused tests under `apps/web/test`, `apps/cloudflare/test`, and package tests if already present.
