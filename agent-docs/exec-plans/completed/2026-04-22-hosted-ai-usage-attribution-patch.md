# Hosted AI usage attribution patch landing

Status: completed
Created: 2026-04-22
Updated: 2026-04-22

## Goal

- Land the supplied hosted AI usage attribution patch on current HEAD without widening beyond the requested privacy-first usage reporting, Stripe metering, schema, and hosted runner env-forwarding slice.

## Success criteria

- Hosted AI usage records persist the requested attribution fields in Postgres with a matching Prisma migration/schema update.
- Hosted provider calls can emit anonymized gateway `user` and `tags` attribution without exposing Stripe customer identifiers to the gateway.
- Stripe metering remains sourced from Murph-owned usage rows and emits the requested token-billing event shape.
- Hosted runner env policy and deployment secret allowlists forward the reporting secret needed for anonymized attribution.
- Focused verification covers the touched hosted web, Cloudflare, assistant-engine, and runtime-state surfaces without disturbing unrelated in-flight work.

## Scope

- In scope:
- `apps/web` hosted AI usage storage, Prisma schema/migration, and Stripe metering changes
- `apps/cloudflare` hosted runner secret forwarding and env policy wiring
- `packages/assistant-engine` usage attribution plumbing and OpenAI-compatible gateway reporting
- `packages/runtime-state` assistant usage record shape updates
- Directly coupled tests or proof scaffolding required to verify the landed behavior
- Out of scope:
- Unrelated hosted typing, Health Commons, or onboarding work already in progress in this checkout
- Broader billing-model changes beyond the supplied patch behavior

## Constraints

- Technical constraints:
- Preserve the hosted DB as the canonical usage ledger and keep Stripe metering server-side from Murph-owned usage records.
- Do not introduce gateway headers or payload fields that expose raw Stripe customer identifiers.
- Keep new persisted state explicitly classified on the existing hosted-web/Postgres boundary.
- Product/process constraints:
- Treat the supplied patch as intent on top of current HEAD and preserve unrelated dirty-tree edits.
- Keep the landing narrow enough for a scoped diff-aware verification lane if it remains truthful.

## Risks and mitigations

1. Risk: The patch could drift against current hosted usage or provider abstractions and silently drop attribution fields.
   Mitigation: Inspect the landed diff file-by-file after apply and run focused verification around usage persistence and gateway option construction.
2. Risk: Billing/privacy regressions could route customer identifiers to the AI gateway or mis-meter Stripe events.
   Mitigation: Review the attribution and metering code paths directly, capture focused proof for the new event shape, and keep Stripe metering sourced from Murph-owned usage rows only.

## Tasks

1. Register the patch landing in the coordination ledger and apply the supplied patch.
2. Inspect the landed diff for scope, privacy, and current-HEAD fit.
3. Run truthful verification for the touched hosted usage owners plus at least one direct scenario-proof lane.
4. Complete the required `coverage-write` and `task-finish-review` audit passes, then rerun affected checks.
5. Commit only the patch files plus the active-plan/ledger updates via the repo completion flow.

## Decisions

- Use a dedicated active plan because the change is high-risk and crosses hosted web, Cloudflare, billing, schema, and provider boundaries.
- Prefer the scoped `bash scripts/workspace-verify.sh test:diff <paths...>` lane over broad acceptance only if it truthfully covers the touched owners on this dirty checkout.

## Verification

- Commands to run:
- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/scripts/deploy-automation/worker-secret-names.ts apps/cloudflare/src/hosted-env-policy.ts apps/web/.env.example apps/web/prisma/migrations/2026042200_hosted_ai_usage_gateway_attribution/migration.sql apps/web/prisma/schema.prisma apps/web/src/lib/hosted-execution/stripe-metering.ts apps/web/src/lib/hosted-execution/usage.ts packages/assistant-engine/src/assistant/provider-turn-runner.ts packages/assistant-engine/src/assistant/providers/openai-compatible.ts packages/assistant-engine/src/assistant/providers/registry.ts packages/assistant-engine/src/assistant/providers/types.ts packages/assistant-engine/src/assistant/service-contracts.ts packages/assistant-engine/src/assistant/service-usage.ts packages/assistant-engine/src/assistant/usage-attribution.ts packages/assistant-engine/src/model-harness.ts packages/runtime-state/src/assistant-usage.ts`
- Focused direct-proof command(s) for hosted usage attribution and Stripe metering after the patch lands
- Expected outcomes:
- Typecheck passes, the diff-aware lane truthfully covers the touched owners, and focused proof confirms anonymized gateway attribution plus token-type Stripe metering behavior without exposing raw customer IDs to the gateway.
Completed: 2026-04-22
