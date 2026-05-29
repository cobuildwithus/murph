# Junction ISO Window Params

## Goal

Preserve precise Junction ingestion windows by sending ISO datetime query
parameters when webhook resource jobs, historical completion checks,
diagnostics, or current-day partial windows carry precise timestamps.

## Scope

- Add one explicit Junction client/query formatting intent instead of spreading
  endpoint-specific formatting logic through the provider.
- Keep intentional full-day reconciliation on date-only Junction params.
- Preserve bounded closed-day timeseries chunking for routine full-day imports.
- Translate exclusive internal full-day window ends to the last included
  date-only `end_date` when date-only reconciliation is intentional.
- Keep raw provider payloads and user/device identifiers out of logs, docs, and
  tests.

## Non-Goals

- No new persisted state.
- No hosted dirty-ack or runtime control-plane changes.
- No provider schema or importer record-shape changes.

## Plan

1. Add a small client-level option for date-only versus ISO datetime Junction
   query params.
2. Route precise webhook/resource, historical, diagnostic, and current-day
   summary windows through ISO datetime params.
3. Leave scheduled/full-day reconciliation and closed-day timeseries chunks on
   date-only params.
4. Add focused regression coverage for the query URLs.

## Verification

- PASS: `pnpm --dir packages/device-syncd test` after final fixes (37 files,
  569 tests).
- PASS: `pnpm --dir packages/device-syncd typecheck` after final fixes.
- PASS: scoped `git diff --check` for the Junction/provider/test/plan paths.
- PASS before the last summary-format fix, then rerun blocked by unrelated
  dirty work: `pnpm typecheck`. The post-fix rerun failed in
  `packages/vault-usecases/src/usecases/integrated-services.ts` on unrelated
  dense raw retention symbols.
- BLOCKED by unrelated affected-package timeout:
  `bash scripts/workspace-verify.sh test:diff packages/device-syncd/src/providers/junction-client.ts packages/device-syncd/src/providers/junction.ts packages/device-syncd/test/junction-provider.test.ts`
  failed in `packages/cli/test/cli-expansion-document-meal.test.ts`.
- Audits: coverage-write added historical backfill ISO URL proof; final
  security/privacy re-review had no findings; final task-finish re-review had
  no findings after the diagnostic precision, precise timeseries yielding, and
  full-day summary date-only fixes.

## Closeout

- Implementation is present in the working tree.
- No scoped commit was created because `packages/device-syncd/src/providers/junction.ts`
  and `packages/device-syncd/test/junction-provider.test.ts` also contain
  unrelated active optional-resource changes from another ledger row, and
  `scripts/finish-task` would stage whole files.
Status: completed
Updated: 2026-05-29
Completed: 2026-05-29
