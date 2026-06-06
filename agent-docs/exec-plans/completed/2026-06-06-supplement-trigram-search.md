Goal:
- Improve hosted supplement search so exact standalone product names can match inside longer natural-language queries.

Success criteria:
- `searchSupplements` includes a Postgres `pg_trgm` product-name candidate path.
- Product-name phrase/similarity matches rank above flat body/search-text matches.
- GET/POST search requests reject oversized query strings before hitting the database.
- Focused tests cover the query shape.
- Required verification passes or unrelated blockers are documented.

Constraints:
- Do not delete or mutate supplement DB rows.
- Do not print `.env.local`, DB URLs, credentials, or raw secret values.
- Keep implementation inside existing `apps/web` supplement lookup boundary.

State:
- Implemented trigram-backed name candidate path and route-level GET query length cap.
- Focused supplement query/route tests passing; app diff verification has unrelated biomarker browse-card failures.

Working set:
- `apps/web/src/lib/supplements.ts`
- `apps/web/app/api/supplements/route.ts`
- `apps/web/test/supplements-lib.test.ts`
- `apps/web/test/supplements-route.test.ts`
- `agent-docs/exec-plans/active/2026-06-06-supplement-trigram-search.md`
Status: completed
Updated: 2026-06-06
Completed: 2026-06-06
