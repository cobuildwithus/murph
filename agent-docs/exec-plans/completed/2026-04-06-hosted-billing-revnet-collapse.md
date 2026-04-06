## Goal (incl. success criteria):
- Remove the hosted onboarding billing-mode configuration branch and make hosted billing subscription-only.
- Remove runtime dependence on `HOSTED_ONBOARDING_REVNET_*` env configuration while keeping the RevNet issuance code wired but hard-disabled.
- Success means hosted onboarding/auth/billing no longer branches on payment vs subscription or on runtime RevNet env presence, wallet gating is aligned to the fixed disabled-RevNet state, and the hosted-web tests/docs reflect the simpler contract.

## Constraints/Assumptions:
- Preserve unrelated dirty-tree edits, especially active Cloudflare and device-sync work.
- Do not remove the RevNet implementation surface entirely; keep it in-tree but behind a fixed-off gate for now.
- Keep hosted billing/activation behavior consistent with the new product rule: subscription checkout only, no live RevNet issuance.
- Update durable docs when architecture/runtime assumptions change.

## Key decisions:
- Treat the user instruction as a product hard-cut: `HOSTED_ONBOARDING_STRIPE_BILLING_MODE` should no longer exist as a runtime input.
- Replace env-driven RevNet enablement with an explicit code-level disabled state rather than deleting all RevNet code in the same pass.
- Remove dead branches instead of preserving compatibility shims where the product direction is now fixed.

## State:
- completed

## Done:
- Read the required routing, architecture, security, reliability, completion-workflow, and verification docs.
- Confirmed this is a high-risk hosted-web change that requires an execution plan and final audit pass.
- Checked the dirty worktree and current coordination ledger before starting edits.
- Removed runtime parsing and validation for `HOSTED_ONBOARDING_STRIPE_BILLING_MODE` and `HOSTED_ONBOARDING_REVNET_*`.
- Hard-cut hosted checkout creation and Stripe entitlement handling to the subscription path while keeping a narrow legacy payment checkout drain path for old in-flight sessions.
- Hard-disabled live RevNet issuance, removed auth/invite wallet gating that only existed for RevNet, and made submitted-issuance receipt reconciliation skip cleanly while RevNet stays disabled.
- Updated hosted tests, docs, and durable architecture/runtime notes to match the fixed subscription-only and disabled-RevNet contract.
- Ran the required audit pass, fixed the findings it surfaced, and re-ran the affected verification.

## Now:
- Close the plan with `scripts/finish-task` and land only the scoped hosted-onboarding paths.

## Next:
- Verify rollout assumptions in staging if desired: legacy payment checkout drain behavior and dormant submitted RevNet-row cron no-op behavior.

## Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: whether production still has any legacy `HostedBillingMode.payment` checkout sessions or `hostedRevnetIssuance.status = submitted` rows that need explicit staging confirmation before rollout.

## Working set (files/ids/commands):
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `agent-docs/exec-plans/active/2026-04-06-hosted-billing-revnet-collapse.md`
- `apps/web/src/lib/hosted-onboarding/**`
- `apps/web/src/components/hosted-onboarding/**`
- `apps/web/test/**`
- `apps/web/README.md`
- `ARCHITECTURE.md`
Status: completed
Updated: 2026-04-06
Completed: 2026-04-06
