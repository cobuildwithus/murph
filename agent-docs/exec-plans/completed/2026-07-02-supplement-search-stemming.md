Goal (incl. success criteria):
- Fix the supplement search recall gap where singular/plural product-name forms never match (live incident: "Advanced Antioxidant" could not find Blueprint's "Advanced Antioxidants" label; the reverse direction also lost all singular-name rows).
- Use Postgres-native full-text stemming instead of more bespoke matching heuristics, keep the foods path's current latency, and close the brand-scope zero-result cliff found in the audit.
- Success means the live regression corpus covers both directions of the incident and passes, unit suites pass, and broad foods queries keep their pre-change latency.

Constraints/Assumptions:
- The generic search SQL is shared by supplements (~239k rows) and foods (~2M rows). Stemmed matching doubles per-candidate ranking cost and widens candidate sets, so it must stay opt-in per table; foods keeps the existing single-config query shape.
- `websearch_to_tsquery('english', ...)` drops stopword-shaped brand tokens ("NOW", "One A Day"), so the 'simple' arm must remain and the stemmed arm is additive (OR), never a replacement.
- Both FTS arms must be GIN-indexed; the `to_tsvector('english', search_text)` expression indexes were created concurrently on the live labels DB (supplements + foods) before this code change deploys, and are recorded in the schema files.
- No new services, columns, or import-pipeline changes; ranking changes stay inside the existing candidate CTE structure.

Key decisions:
- Dual-config FTS (`simple` OR `english`) gated by a `stemmedSearch` option enabled only for supplements.
- New `stemmed_name_match` ranking tier ("query equals full product name up to stemming") directly below the raw phrase-containment tier, so exact-modulo-plural names beat partial-name matches.
- Word-bound the generic path's `name_phrase_match` strpos containment (space padding) so short names can no longer phrase-match inside unrelated query words.
- Empty brand-scoped results now fall back to the generic path instead of returning nothing (ingredient-shaped brand names could hijack a query into an exclusive empty scope).

State:
- Implementation, tests, and live verification complete; committing.

Done:
- Reproduced the incident and its mirror image against the live labels DB through the real query functions.
- Verified planner uses BitmapOr across both GIN indexes (5.8s seq scan -> 1.3ms) and created the english expression indexes concurrently on the live DB.
- Adversarial audit of the full search path; adopted the two cheap high-severity findings (brand-scope fallback, word-bounded phrase match), deferred brand-heuristic redesign, UPC width matrix, and diacritics as follow-ups.
- Live corpus extended with the incident regression; all live + unit suites pass; foods latency confirmed unchanged; supplements broad queries ~2x but well under the 8s statement timeout.

Now:
- Final scoped commit via scripts/finish-task, open PR, run the PR-lane ReviewGPT loop.

Next:
- N/A (follow-ups recorded in the PR description).

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- apps/web/src/lib/product-labels.ts
- apps/web/src/lib/supplements.ts
- apps/web/sql/supplements/schema.sql
- apps/web/sql/foods/schema.sql
- apps/web/test/supplements-lib.test.ts
- apps/web/test/supplements-search-live.test.ts
- MURPH_LABELS_DB_URL=... pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/supplements-search-live.test.ts
- pnpm test:diff apps/web/src/lib/product-labels.ts apps/web/src/lib/supplements.ts
Status: completed
Updated: 2026-07-02
Completed: 2026-07-02
