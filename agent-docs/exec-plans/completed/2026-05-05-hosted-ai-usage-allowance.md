Goal (incl. success criteria):
Implement hosted AI usage allowance tracking with minimal durable primitives: raw usage facts remain in web, allowance pricing/accounting is attached to usage rows, monthly aggregate spend is tracked per member period, and Cloudflare blocks new invocations when the web gate says the current period is over limit.

Constraints/Assumptions:
- Web remains the canonical owner of hosted billing and hosted AI usage state.
- Runtime must not learn plan, dollar, period, or quota logic.
- Cloudflare may coordinate and enforce a web gate decision before beginning an invocation, but must not own a usage ledger.
- Usage caps are post-task hard stops, not prepaid exact caps.
- Preserve unrelated dirty work and active rows.

Key decisions:
- Add accounting columns to HostedAiUsage plus one HostedAiUsagePeriod aggregate.
- Reuse existing Cloudflare callback authentication for the internal gate route.
- Gate decisions derive from spent vs limit; any status-like metadata is not authoritative.
- Fail closed before starting new AI work when the gate cannot be read.

State:
Implementation and verification complete. Scoped commit is blocked by overlapping unrelated dirty work in shared files.

Done:
- Architecture review completed against current usage import/export and Cloudflare runner flow.
- Repo workflow, security, reliability, and verification docs loaded.
- Added HostedAiUsage allowance accounting columns and HostedAiUsagePeriod aggregate.
- Added web allowance pricing/accounting, internal usage gate, and billing-period snapshot persistence.
- Added Cloudflare pre-invocation gate enforcement with fail-closed scheduling.
- Kept the usage gate worker-only and off the runtime web-control proxy.
- Added hosted account export/delete coverage for HostedAiUsagePeriod.
- Added focused web and Cloudflare tests for accounting, gating, privacy inventory, and proxy exclusion.
- Security/privacy, simplification, and coverage audit findings handled.
- Full `pnpm verify:acceptance` passed.
- Final completion review found fallback-period carry-forward could misplace usage across Stripe boundaries; fixed by moving accounted usage rows by `occurredAt` and recomputing old fallback aggregates.
- Re-ran focused web/Cloudflare lanes, web typecheck, `git diff --check`, and full `pnpm verify:acceptance`; all passed.

Now:
- Close the plan without a scoped commit because overlapping unrelated dirty work prevents safe staging.

Next:
- Hand off with deployment order and note commit blocker.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- apps/web/prisma/schema.prisma
- apps/web/prisma/migrations/**
- apps/web/src/lib/hosted-onboarding/**
- apps/web/src/lib/hosted-execution/**
- apps/web/app/api/internal/hosted-execution/**
- apps/web/test/**
- apps/cloudflare/src/**
- apps/cloudflare/test/**
Status: completed
Updated: 2026-05-05
Completed: 2026-05-05
