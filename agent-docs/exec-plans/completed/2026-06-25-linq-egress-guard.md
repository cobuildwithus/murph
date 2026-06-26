Goal (incl. success criteria):
- Land the 28-day Linq/iMessage egress guard patch on top of PR #310.
- Success means durable route freshness projections are updated from real inbound Linq messages, background/proactive Linq sends are blocked without recent inbound engagement, skipped sends are recorded in HostedLinqDelivery, and current foreground replies remain low-latency.
- Required verification passes or any unrelated blocker is documented, the PR branch is pushed, and ReviewGPT is restarted against the updated PR.

Constraints/Assumptions:
- Preserve the event-sourced observability primitives already committed in PR #310.
- Do not expose raw phone numbers, message text, provider payloads, secrets, or local identifiers.
- Current foreground replies to the just-received inbound may use wake/plan context as freshness proof; other sends must prove recent inbound through durable state.
- Keep the guard minimal and observationally clear; do not add broader failover or budgeting behavior.

Key decisions:
- Reconcile the supplied patch manually where current PR code has diverged.
- Use HostedLinqDelivery skipped-send rows as the durable side-effect ledger for blocked sends.

State:
- Complete; awaiting scoped commit, push, PR update, and ReviewGPT restart.

Done:
- Stopped the stale ReviewGPT run from the pre-guard PR revision.
- Confirmed the patch does not apply cleanly and identified affected areas.
- Applied and manually reconciled the patch.
- Preserved current inbound reply bypass for web-owned side effects and hosted-runtime foreground deliveries.
- Hardened skipped delivery writes to upsert the line before writing line FKs and to use stable idempotency for voice-memo skips.
- Focused verification passed: Linq web egress/observability/webhook/transport/dispatch tests, assistant-runtime callbacks test, web/cloudflare/hosted-execution/assistant-runtime typechecks, raw-log guard, and diff whitespace check.
- Full `pnpm verify:acceptance` passed.

Now:
- Commit and push the PR branch.

Next:
- Update PR #310 and restart ReviewGPT.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- apps/web/prisma/schema.prisma
- apps/web/prisma/migrations/**
- apps/web/src/lib/hosted-onboarding/**
- apps/web/src/lib/hosted-routing/thread-route-store.ts
- apps/web/src/app/api/internal/hosted-runtime/**
- packages/hosted-execution/src/routes.ts
- packages/assistant-runtime/src/**
Status: completed
Updated: 2026-06-25
Completed: 2026-06-25
