## Goal

Land the supplied hosted pricing patch so Murph launch billing supports explicit monthly and annual plan selection instead of one hard-coded Stripe price.

## Scope

- `agent-docs/product-marketing-context.md`
- `apps/web/.env.example`
- `apps/web/README.md`
- `apps/web/app/api/hosted-onboarding/billing/checkout/route.ts`
- `apps/web/app/page.tsx`
- `apps/web/src/components/homepage/{faq-section,hero-section,site-footer}.tsx`
- `apps/web/src/components/hosted-onboarding/{client-api,hosted-auth-completion,join-invite-client,join-invite-preview,join-invite-sections,join-invite-stage-panels,join-invite-state}.ts*`
- `apps/web/src/lib/hosted-onboarding/{billing-plans,billing-service,env,invite-service,runtime,types}.ts`
- `scripts/dev-hosted-local/main.ts`

## Constraints

- Keep the change scoped to the returned pricing artifact and do not broaden into unrelated hosted onboarding auth or routing work.
- Preserve overlapping in-flight `apps/web` onboarding edits and merge the pricing behavior on top of current tree state instead of restoring older file versions.
- Keep Stripe checkout and webhook behavior subscription-based; only plan selection and pricing copy should change.

## Verification

- `pnpm --dir apps/web verify` (fails on unrelated pre-existing `apps/web/test/{page,join-page,hosted-wake-routes,settings-page}.test.ts` expectations and settings-page markup work outside this pricing scope; pricing-updated invite/auth tests are green inside the hosted-web lane)
- Required completion audits for an `apps/web` UI change: `coverage-write`, `frontend-review`, `task-finish-review`
- Audit-pass blocker: repo policy requests dedicated audit subagents, but this turn does not authorize sub-agent delegation; report the gap in handoff rather than silently downgrading the required passes.
Status: completed
Updated: 2026-04-18
Completed: 2026-04-18
