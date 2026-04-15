# Goal (incl. success criteria):
- Add clean, low-noise timing logs across the main hosted onboarding latency checkpoints so we can see where signup time is spent in production.
- Success means the logs cover the route/service milestones around Privy completion, checkout creation, Cloudflare warmup/provisioning, activation, and Stripe reconciliation without exposing user identifiers.

# Constraints/Assumptions:
- Keep the write set narrow to hosted onboarding observability only.
- Timing payloads must stay sanitized and avoid member ids, phone numbers, emails, wallet addresses, secrets, or raw URLs.
- Preserve unrelated dirty `package.json` and `pnpm-lock.yaml` edits.

# Key decisions:
- Add one shared hosted-onboarding timing helper instead of ad hoc `Date.now()` logging at each call site.
- Instrument both route-level and service-level checkpoints so we can compare user-visible latency with internal substep latency.
- Prefer compact `console.info` payloads with stable `step`, `outcome`, and `elapsedMs` fields plus a few boolean/string breadcrumbs.

# State:
- completed

# Done:
- Reviewed the current warmup, checkout, activation, and Stripe reconciliation owners to identify non-overlapping instrumentation points.
- Added a shared hosted-onboarding timing logger and wired it into the main signup, warmup, activation, and Stripe reconciliation checkpoints.
- Added targeted timing-log test coverage and quieted the affected suites with `console.info` spies.
- Verified the slice with focused Vitest and `pnpm --dir apps/web typecheck`.

# Now:
- Handoff only.

# Next:
- UNCONFIRMED whether we want to add deeper per-query/per-Stripe-call timing once the first production traces identify the slowest step.

# Open questions (UNCONFIRMED if needed):
- UNCONFIRMED whether route-level timing plus the selected service substeps is enough, or whether we will want deeper Prisma/Stripe phase timing later.

# Working set (files/ids/commands):
- Files: `apps/web/app/api/hosted-onboarding/{billing/checkout,privy/complete}/route.ts`, `apps/web/src/lib/{hosted-execution/control.ts,hosted-onboarding/{authentication-service.ts,billing-service.ts,logging.ts,member-activation.ts,stripe-event-reconciliation.ts}}`, targeted `apps/web/test/**`, this plan, and the coordination ledger
- Commands: focused `pnpm exec vitest run --config apps/web/vitest.workspace.ts ...`, `pnpm --dir apps/web typecheck`, `pnpm --dir apps/web verify`, `bash scripts/finish-task ...`
Status: completed
Updated: 2026-04-13
Completed: 2026-04-13
