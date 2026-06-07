# Coordination Ledger

Active coding work must register here before code changes begin.
Rows are active-work notices by default, not hard file locks.
Use `Notes` to mark a lane as exclusive when overlap is unsafe, such as a large refactor or delicate cross-cutting rewrite.

| Agent | Scope | Plan | Files | Symbols | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Codex | Pulse Trial usage allowance | `agent-docs/exec-plans/active/pulse-trial-usage-limit.md` | `apps/web/src/lib/hosted-onboarding/billing-plans.ts`, `apps/web/src/components/hosted-onboarding/join-invite-stage-server.tsx`, `apps/web/test/hosted-execution-usage-allowance.test.ts`, `agent-docs/product-specs/pulse-trial-checkout-offer.md`, `agent-docs/product-specs/pulse-trial-start-paid-pulse.md` | `HOSTED_PULSE_TRIAL_USAGE_LIMIT_USD_MICROS`, `resolveHostedAiUsageGate` | in_progress | Scoped hosted billing/usage policy update; preserve unrelated dirty files. |
