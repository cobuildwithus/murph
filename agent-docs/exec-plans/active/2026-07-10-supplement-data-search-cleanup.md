# Supplement Data And Search Cleanup

## Goal

Audit the complete canonical supplement-label corpus, preserve a recoverable local snapshot, correct only evidence-backed invalid rows, and improve `/api/supplements` search with a deterministic regression corpus of at least 100 representative queries.

Success means:

- every row is classified by structural validity, source provenance, normalization coverage, duplicate/canonical grouping, and search-document quality;
- any database mutation is preceded by an exact dry-run artifact and rollback snapshot;
- malformed, duplicate, orphaned, food/bundle, or untrustworthy rows are repaired or removed only when the evidence and repository rules make the action unambiguous;
- search quality is measured against a checked-in 100+ query expectation corpus, with focused unit/integration tests and live-database proof;
- required verification, completion audits, PR review, and mergeability checks pass.

## Constraints

- Never print, copy, commit, or expose database URLs, credentials, `.env` contents, raw connection strings, personal identifiers, or local paths.
- Treat `MURPH_LABELS_DB_URL` as the canonical shared labels database authority; the legacy supplement variable may be compared only through secret-safe endpoint equality checks.
- Start read-only. Do not mutate the database until the snapshot, row classifications, proposed actions, before/after counts, and rollback path are reviewed mechanically.
- Preserve official/raw evidence for uncertain rows. Automated repair requires production-quality normalized `ingredientRows` and `servingSizes`; otherwise retain the row for explicit review/refetch.
- Do not infer formula facts, amounts, units, serving sizes, variants, or provenance from marketing text.
- Keep search on the existing PostgreSQL full-text/trigram owner. Add no new search service, dependency, or persisted state.
- Preserve unrelated working-tree, ledger, database, and active-plan work. The older brand-site backfill row is prior context, not authority to reuse its dirty worktree.
- Database mutation and code changes are separate reviewable steps. Use transactions, exact predicates, and post-write verification.

## Plan

1. Inspect the current table/schema/search implementation and securely snapshot the supplement corpus outside the repository.
2. Run a complete, aggregate-first data-quality audit and emit secret-free local review artifacts with exact invalid-row categories.
3. Build and execute a deterministic 100+ query search baseline covering exact products, brands, ingredients, forms, aliases, typos, punctuation, numeric/UPC inputs, reordered terms, and adversarial/empty inputs.
4. Add the smallest durable validation, cleanup, and ranking fixes required by failing evidence, with regression tests before behavior changes.
5. Dry-run exact database actions against the snapshot/current head, apply only unambiguous safe actions, and verify counts, constraints, canonical groups, provenance, and live search afterward.
6. Run the required apps/web verification, security/privacy review, coverage-write pass, parent final review, scoped commit/PR flow, ReviewGPT gate, CI, and mergeability proof.

## Verification

- Secret-safe database schema and aggregate audit queries
- Recoverable schema/data snapshot with permissions checked and no repo tracking
- Checked-in 100+ query corpus plus focused deterministic tests
- `pnpm test:diff` for touched app/script/test paths when truthful
- `pnpm verify:acceptance` for the final high-risk data/search change
- Live `apps/web/test/supplements-search-live.test.ts` against the canonical labels database
- Dry-run and transaction-level before/after database reports
- `git diff --check`
- Required `security-privacy-review` and `coverage-write` completion passes
- Parent final review, PR ReviewGPT zero accepted findings, green CI, and clean mergeability proof

## State

Active. Canonical and legacy env keys resolve to the same endpoint. A complete
239,367-row compressed CSV snapshot was captured and verified outside git before
mutation. Its compressed SHA-256 is
`542c72b7e029d4b5380c61de77ba88e17a94e2dbfc3784bb010bebeb1cd8969a`. A
239,365-row post-repair snapshot was also captured and verified; its compressed
SHA-256 is
`ff57056f237127a4e9ff8b0810a80103da02bb6faf8730f3c01d671c4513b835`.
The reusable aggregate auditor completed against every live row in read-only
transactions, and the brand-site repair preview completed without writes.

The audit found no blank required top-level fields, invalid origin identities,
canonical orphans, future imports, or linked product-test orphans. One
brand-site search document is over the 6,000-character contract and has a
deterministic 218-character replacement from the maintained search-text
builder. Twelve DSLD labels omit `ingredientRows`, but the current official NIH
API returns those fields as source-null too, so they are not database
corruption. Two DailyMed combo-kit rows do not fit the one-formula-per-row
contract and remain review/removal candidates. Duplicate groups are retained as
review candidates because DSLD label history and product variants make counts
alone insufficient evidence for deletion.

The exact repair was dry-run with rollback, then applied in one guarded
transaction: one oversized brand-site search document was rebuilt and the two
source-verified non-standalone DailyMed combo rows were removed. The payload and
serving constraints are validated. The post-write audit reports 239,365 rows,
zero identity/canonical failures, zero oversized search documents, zero product
test orphans, and no missing normalized DailyMed arrays. The twelve current
official-source-null DSLD ingredient arrays remain intentionally preserved.

Search regression work proved a normalized-brand collision: the catalog
spellings `NOW`, `Now`, and `now` suppressed one another and prevented brand
scoping. The local fix preserves same-normalization spellings, normalizes Unicode
compatibility punctuation, rejects weak-only/nonlexical catalog searches, and
prevents invalid-width GTIN aliases. A relevance-before-source ordering
experiment was reverted after live Solgar regressions proved it unsafe.

The checked-in PostgreSQL corpus now covers 121 named searches over 57 fixture
rows. All 124 corpus/safety checks pass against an ephemeral PostgreSQL instance
with the real full-text, trigram, stemming, canonical-dedupe, and brand-scoping
queries. That run exposed one additional modifier-letter apostrophe bug; the
normalizer now folds the supported apostrophe forms before brand matching. Both
importers, the new payload constraint, and repeated schema application also pass
ephemeral PostgreSQL execution with valid and deliberately rejected fixtures.
The focused route/library suite, aggregate-auditor suite, and ten-case live
canonical-database search suite pass after the production repair.

The task branch is fast-forwarded to the current upstream base with no overlap in
the supplement scope. The normal pull-request app-verification job now provisions
an isolated PostgreSQL service for this corpus, while the test creates `pg_trgm`
inside its rollback-only transaction, so all 121 real search cases run in CI
instead of silently skipping.

A completion security review found that node-postgres accepts a query-string
`host` override even when the URL authority is loopback. The test database guard
now validates that effective host, rejects duplicate overrides, and has direct
remote-override regressions; the full PostgreSQL corpus still passes all 124
checks. The auditor now imports the shared search-document length constant,
labels bounded candidate IDs as selected drilldowns rather than a comprehensive
second classification, and names the already-applied one-time repair as an
immutable July 2026 artifact.

Next is the final scoped and acceptance verification, required coverage and
security re-audit, parent final review, scoped commit/PR flow, ReviewGPT, CI, and
mergeability proof.
