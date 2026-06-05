# DailyMed Supplement Labels

## Goal

Add DailyMed dietary-supplement SPL labels as a second source for the hosted supplements lookup without broadening the runtime architecture.

Success means the existing `/api/supplements` route can search DSLD plus deduped DailyMed external labels, exact DSLD lookups still work, and the production import path is ready for the Murph external-data Postgres database.

## Constraints

- Keep the v1 external-data architecture simple: one additional table, no new service, no new dependency, no vector store.
- Keep `MURPH_DATA_API_KEY` server-side and injected by Cloudflare only.
- Do not commit downloaded DailyMed XML, DSLD JSON/NDJSON, generated import NDJSON, or local credentials.
- Treat production DB credentials and local env files as secret inputs; never print them.

## Scope

- `apps/web/sql/supplements/schema.sql`
- `apps/web/sql/supplements/import.sql`
- `apps/web/sql/supplements/import-dailymed.sql`
- `apps/web/src/lib/supplements.ts`
- `apps/web/test/supplements-lib.test.ts`
- `packages/cli/src/supplement-labels.ts`
- `packages/cli/test/supplement-labels.test.ts`
- `ARCHITECTURE.md`

## Plan

1. Download and normalize DailyMed dietary-supplement SPL labels into scratch NDJSON.
2. Dedupe DailyMed records against the existing DSLD import using conservative exact normalized matches.
3. Add a minimal external-label table and import script.
4. Extend the existing web query helper to include non-duplicate external labels in search results.
5. Run focused verification and completion reviews.
6. Attempt the production schema/import with the configured DB URL without exposing the URL.

## State

Implementation and completion reviews complete; preparing scoped commit and push.

## Done

- Downloaded 576 DailyMed dietary-supplement SPL XML files in scratch storage.
- Normalized 576 DailyMed records into scratch NDJSON.
- Dedupe pass found 467 visible new rows and 109 DSLD matches.
- Added `supplement_external_labels`, DailyMed import SQL, query union, source metadata, and focused tests.
- Fixed review findings so external ids round-trip through the CLI, import scripts fail closed on missing NDJSON env vars, and partial DSLD imports do not hide unmatched DailyMed rows.
- Fixed dedupe so an external row stays visible when its matched DSLD representative is filtered out by the default off-market filter or does not match the active UPC/search predicate.
- Proved schema/import scripts against a disposable local Postgres instance.
- Attempted production import; blocked by current DB role lacking `CREATE` on `public`.
- Completed final review. The remaining production risk is deployment order: apply the external-label schema before deploying web code that references it.

## Now

- Commit through `scripts/finish-task` and push the PR branch.

## Next

- Commit through `scripts/finish-task` and push the PR branch.
Status: completed
Updated: 2026-06-05
Completed: 2026-06-05
