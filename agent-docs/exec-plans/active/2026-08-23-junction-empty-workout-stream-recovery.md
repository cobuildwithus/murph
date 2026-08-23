# Recover empty Junction workout streams

Status: active
Created: 2026-08-23
Updated: 2026-08-23

## Goal

- Let device reconciliation complete when Junction returns a structurally valid
  workout stream with no timestamps, without deleting existing canonical facts
  or preventing a later populated stream from being imported.

## Success criteria

- An empty timestamp array produces no new workout-stream feature and does not
  fail the surrounding reconcile.
- The empty response does not run a canonical import, so an existing feature is
  left untouched.
- A later reconcile for the same workout fetches the provider stream again and
  imports it when timestamps become available.
- Over-limit timestamp arrays remain bounded and fail closed with the existing
  typed aggregate-only diagnostic.
- Focused reducer and provider tests, affected typechecks, required review gates,
  CI, production deployment, and live recovery proof pass.

## Scope

- In scope: Junction workout-stream reduction, provider recovery coverage,
  owning reliability documentation, and one public-safe changelog item.
- Out of scope: new queues or schedulers, raw stream retention, timestamp-limit
  changes, provider payload logging, mailbox-state changes, and canonical data
  deletion or repair.

## Constraints

- Keep the existing serial workout-stream fetch owner and bounded continuation.
- Preserve all prior canonical workout facts when the provider has no stream
  feature to contribute on the current pass.
- Never persist or log workout identifiers, timestamps, metric arrays, or raw
  provider responses.

## Tasks

1. Change only the empty timestamp case to the reducer's existing no-feature
   result; retain the over-limit error.
2. Add focused reducer and provider coverage proving no import on empty and a
   successful import on a later populated reconcile.
3. Update the owning reliability docs and public changelog.
4. Run focused tests and typechecks, review the exact diff, push a candidate,
   and complete the repository review and CI gates.
5. Merge and deploy the runner, then verify the affected reconcile advances
   without a new empty-stream failure or canonical withdrawal.

## Verification

- `pnpm --dir packages/importers exec vitest run --config vitest.config.ts
  --no-coverage test/device-providers-junction-bounded-features.test.ts`
  (13 passed)
- `pnpm --dir packages/device-syncd exec vitest run --config vitest.config.ts
  --no-coverage test/junction-provider.test.ts` (323 passed)
- `pnpm --filter @murphai/importers typecheck`
- `pnpm --filter @murphai/device-syncd typecheck`
