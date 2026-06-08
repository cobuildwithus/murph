# Supplement Brand Search

## Goal

Make hosted supplement label search treat a brand named in the user query as a constraint, so branded misses return no same-query false positive from another brand while existing unbranded searches keep working.

## Scope

- `apps/web/src/lib/supplements.ts`
- `apps/web/sql/supplements/schema.sql`
- `apps/web/sql/supplements/import.sql`
- `apps/web/sql/supplements/import-dailymed.sql`
- `apps/web/test/supplements-lib.test.ts`

## Constraints

- Keep the API surface unchanged.
- Use existing `supplements.brand`, `supplements.name`, and `supplements.search_text` columns.
- Do not introduce a separate brand registry, service, or search abstraction.
- Preserve generic searches when no real candidate brand appears in the query.

## Verification

- Focused app/web supplement tests.
- Direct local supplement DB scenario proof for the reported queries.
- Required completion audits per workflow.
Status: completed
Updated: 2026-06-08
Completed: 2026-06-08
