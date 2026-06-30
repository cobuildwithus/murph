Goal (incl. success criteria):
- Move the Pulse Trial reset from a laptop-dependent script into the protected hosted ops surface and remove the local script entrypoint.
- Success means an allowlisted ops user can dry-run and apply the reset from `/ops/pulse-trial-reset`, the endpoint uses the existing hosted session/CSRF gates, and the core reset path still updates Stripe before local billing rows.

Constraints/Assumptions:
- Keep the reset logic single-owned in hosted-ops code used by the ops route.
- Return counts and timestamps only; do not expose member ids, customer ids, subscription ids, or secrets in API/UI output.
- Preserve the existing 10-day Pulse Trial policy and Stripe metadata semantics.
- Do not add new admin auth, queues, persisted job state, or speculative audit tables.

Key decisions:
- Use the existing `/api/ops/*` route-handler pattern with `requireHostedOpsRequestAccess(..., { requireMutationOrigin: true })`.
- Add a dedicated `/ops/pulse-trial-reset` page rather than folding billing mutation controls into runtime maintenance.
- Add a gated `/ops` index so the new reset page is reachable from the ops area.
- Remove the local reset script so operators do not rely on an environment path that lacks hosted server credentials.

State:
- In progress.

Done:
- Confirmed the current reset script owns the required Stripe-first reset logic and safe count-only summary.
- Confirmed ops pages are allowlisted dashboard pages backed by `/api/ops/*` route handlers.

Now:
- Finish tests for the hosted-ops reset module and route.

Next:
- Add focused route/UI tests, run scoped verification, and finish with a scoped commit.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- apps/web/src/lib/hosted-ops/pulse-trial-reset.ts
- apps/web/app/(dashboard)/ops/page.tsx
- apps/web/app/api/ops/pulse-trial-reset/route.ts
- apps/web/app/(dashboard)/ops/pulse-trial-reset/*
- apps/web/test/hosted-pulse-trial-reset.test.ts
- apps/web/test/hosted-ops-pulse-trial-reset.test.ts
- pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-pulse-trial-reset.test.ts apps/web/test/hosted-ops-pulse-trial-reset.test.ts
- pnpm --dir apps/web typecheck
Status: completed
Updated: 2026-06-30
Completed: 2026-06-30
