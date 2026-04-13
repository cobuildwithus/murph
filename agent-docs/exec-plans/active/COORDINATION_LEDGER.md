# Coordination Ledger

Active coding work must register here before code changes begin.
Rows are active-work notices by default, not hard file locks.
Use `Notes` to mark a lane as exclusive when overlap is unsafe, such as a large refactor or delicate cross-cutting rewrite.

| Agent | Scope | Plan | Files | Symbols | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Codex | Reconcile hosted Stripe checkout success redirects immediately after return | `agent-docs/exec-plans/active/2026-04-13-hosted-checkout-success-reconciliation.md` | `apps/web/{app/join/[inviteCode]/success/**,app/api/hosted-onboarding/billing/**,src/components/hosted-onboarding/**,src/lib/hosted-onboarding/**,test/**}` | hosted checkout success route, Stripe billing success reconciliation, join success polling | in_progress | Keep this narrow to hosted onboarding success/billing redirect handling. Do not touch active settings billing-state files unless required for a merge-safe overlap fix. |
