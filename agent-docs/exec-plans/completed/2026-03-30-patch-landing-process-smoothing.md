# Smooth exec-plan drift checks and supplied-patch workflow

Status: completed
Created: 2026-03-30
Updated: 2026-03-30

## Goal

Reduce process friction for narrow patch landings by exempting execution-plan churn from the `agent-docs/index.md` drift requirement and documenting a lighter ledger-first workflow for user-supplied patch integration.

## Success criteria

- `pnpm test` no longer fails solely because `agent-docs/exec-plans/**` or the coordination ledger changed without an `agent-docs/index.md` edit.
- Durable docs still require `agent-docs/index.md` updates when they change.
- Repo docs describe a supplied-patch workflow where narrow patch landings use a ledger row by default and only require a full execution plan if the work expands.

## Scope

- In scope:
  - `AGENTS.md`
  - `agent-docs/{index.md,PLANS.md,operations/{completion-workflow,verification-and-runtime}.md,exec-plans/active/README.md}`
  - `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- Out of scope:
  - changing completion-audit requirements outside the narrow supplied-patch carveout already requested
  - regenerating unrelated prompt or inventory docs

## Tasks

1. Confirm whether docs-drift enforcement already exempts execution-plan churn, then align the repo docs/process guidance with the actual behavior.
2. Document the ledger-first supplied-patch workflow in the durable process docs.
3. Run the required repo verification commands and record any unrelated failures.

## Verification

- `pnpm typecheck`
  - Failed for an unrelated pre-existing hosted-web typecheck error at `apps/web/src/lib/hosted-execution/hydration.ts:267` (`TS2532: Object is possibly 'undefined'`).
- `pnpm test`
  - Failed for unrelated pre-existing hosted-web test regressions in `apps/web/test/hosted-onboarding-stripe-event-queue.test.ts` (six failures around session revocation expectations staying `null`).
- `pnpm test:coverage`
  - Failed for unrelated pre-existing `packages/cli` build/type issues, including missing `@murph/query` resolution and existing type mismatches in `meal.ts`, `promotions.ts`, and `integrated-services.ts`.

## Notes

- The repo-tools docs-drift guard already exempted `agent-docs/exec-plans/(active|completed)/**` from the `agent-docs/index.md` requirement. This task aligned the human-facing docs and routing rules with that existing behavior instead of changing the wrapper implementation.
Completed: 2026-03-30
