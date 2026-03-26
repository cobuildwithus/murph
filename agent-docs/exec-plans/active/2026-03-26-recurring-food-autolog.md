# Recurring food auto-log

Status: completed
Created: 2026-03-26
Updated: 2026-03-26

## Goal

- Add a thin recurring-food layer on top of the existing food registry and assistant cron runtime.
- Let food records optionally persist `autoLogDaily.time`.
- Expose `vault-cli food add-daily <title> --time <HH:MM>` so operators can create or update the remembered food and its paired cron-backed auto-log job in one step.

## Success criteria

- Food frontmatter, core parsing, and query reads all preserve `autoLogDaily.time`.
- `food add-daily` returns the saved food plus the paired cron job metadata.
- Assistant cron can carry a `foodAutoLog.foodId` target and, when triggered, write a derived note-only meal directly from the saved food record without invoking the assistant provider.
- Focused tests cover core/query persistence, CLI routing/schema, and cron-run meal creation.

## Scope

- In scope:
  - food record contract, schema, core, and query plumbing for `autoLogDaily`
  - `food add-daily` CLI/service/use-case wiring
  - assistant-cron job metadata plus derived meal auto-log execution
  - focused docs and regression tests
- Out of scope:
  - arbitrary recurring-meal scheduling beyond one daily time
  - background cron execution outside the existing `assistant run` loop
  - assistant prompt/tool behavior changes beyond the narrow cron-backed write path

## Constraints

- Keep the recurring-food layer thin and additive on top of the current food registry.
- Preserve the existing assistant-cron state model and run-history behavior.
- Implement against the current tree rather than force-applying stale patch hunks.
- Preserve in-flight protocol terminology changes in overlapping files.

## Risks and mitigations

1. Risk: overlapping dirty edits in food/contract files make stale patch hunks unsafe.
   Mitigation: read current file contents first, patch only the exact recurring-food additions, and preserve unrelated diff lines.
2. Risk: cron-backed food auto-log accidentally routes through provider chat instead of a direct derived meal write.
   Mitigation: add explicit `foodAutoLog` job metadata and branch cron execution before `sendAssistantMessage`.
3. Risk: `food add-daily` can leave a half-configured food if cron creation fails.
   Mitigation: keep the flow minimal, detect conflicting existing jobs up front, and best-effort clear freshly added `autoLogDaily` when cron creation fails.

## Tasks

1. Extend contracts/core/query food models with optional `autoLogDaily.time`.
2. Add `food add-daily` use-case, command wiring, manifest/generation updates, and helpers for recurring-food cron naming/rendering.
3. Extend assistant cron job contracts and execution to support direct food auto-log meal writes.
4. Add focused tests and update command/contract docs.
5. Run required verification and completion audits, then remove the ledger row.

## Verification

- Focused commands:
  - `pnpm exec vitest run packages/core/test/health-bank.test.ts packages/query/test/foods.test.ts packages/cli/test/assistant-cron.test.ts packages/cli/test/cli-expansion-provider-event-samples.test.ts packages/cli/test/incur-smoke.test.ts --no-coverage --maxWorkers 1`
- Required commands:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
- Outcomes:
  - `pnpm typecheck` passed.
  - `pnpm test` passed.
  - `pnpm test:coverage` passed.
  - Direct scenario check passed after initializing a temporary vault: `init`, `food add-daily "Test Yogurt Bowl" --time 08:30 --note "Greek yogurt with berries"`, `assistant cron run <jobId>`, then `meal show <mealId>` returned one derived meal whose note was `Test Yogurt Bowl` plus `Greek yogurt with berries`.
