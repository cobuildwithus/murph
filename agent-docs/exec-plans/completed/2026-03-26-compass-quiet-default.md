# Compass-first quiet-default product follow-up

## Goal

Apply a narrow repo-level implementation of the new Healthy Bob product posture without adding new CLI nouns or heavyweight canonical schemas.

## Scope

- strengthen the durable assistant bootstrap prompt with the new philosophy and quiet-default posture
- shift the built-in weekly scheduled update from a progress/protocol snapshot toward a compass-style weekly summary
- move the local web overview surface toward a compass-first home that leads with what changed, what stayed steady, and what can stay simple
- align nearby product docs/copy with the calmer framing

## Files

- `agent-docs/PRODUCT_CONSTITUTION.md`
- `agent-docs/PRODUCT_SENSE.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `packages/cli/src/assistant/service.ts`
- `packages/cli/src/assistant/cron/presets.ts`
- `packages/cli/src/setup-wizard.ts`
- `packages/cli/src/setup-cli.ts`
- `packages/cli/test/{assistant-service.test.ts,assistant-cron.test.ts}`
- `packages/web/app/page.tsx`
- `packages/web/src/lib/overview-compass.ts`
- `packages/web/test/page.test.ts`
- `packages/web/README.md`

## Constraints

- no new top-level CLI paths
- no new canonical vault schema
- keep the web surface operator-facing and simple
- prefer copy/ordering/summary logic over new persistent product state

## Verification

- focused Vitest runs for assistant prompt, assistant cron preset, and web page/overview tests
- required repo checks: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`
- browser inspection at desktop and mobile widths for the local web overview surface
Status: completed
Updated: 2026-03-26
Completed: 2026-03-26
