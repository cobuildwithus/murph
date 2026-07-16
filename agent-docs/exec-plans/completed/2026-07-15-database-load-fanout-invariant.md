# Database load and fanout invariant

Status: completed
Created: 2026-07-15
Updated: 2026-07-15

## Goal

- Add one durable cross-cutting invariant that prevents collection-shaped work
  from turning into unbounded database, decryption, or provider fanout while
  preserving required authority checks and owner boundaries.

## Success criteria

- `docs/contracts/00-invariants.md` states enforceable rules for set-based
  reads, bounded concurrency, owner-policy reuse, crypto handling, and
  max-cardinality proof.
- The rule distinguishes duplicate reads from required live authority checks.
- The final Markdown-only diff passes direct readback and doc-drift checks.

## Scope

- In scope: the baseline invariant contract and this task's plan/ledger
  lifecycle.
- Out of scope: runtime code, pool tuning, PlanetScale configuration changes,
  schema changes, and edits to historical completed plans.

## Constraints

- Technical constraints: keep tunable numeric budgets in owner docs and tests;
  do not encode today's database or KMS provider as permanent architecture.
- Product/process constraints: edit and commit directly on `main` as requested,
  preserve unrelated active work, and use the docs-only verification path.

## Risks and mitigations

1. Risk: A broad rule could encourage removal of required authorization reads.
   Mitigation: state explicitly that lifetime, target, and irreversible-effect
   revalidation remains authoritative.
2. Risk: Prose alone may not stop future query amplification.
   Mitigation: require deterministic maximum-cardinality tests for query and
   external-call counts, selected fields, ordering, and concurrency.

## Tasks

1. Verify the invariant admission test and current database-owner boundaries.
2. Add the database-load and collection-fanout invariant.
3. Read back the final text, run docs checks, inspect the diff, and commit the
   scoped change on `main`.

## Decisions

- Keep this provider-neutral and cross-cutting. PlanetScale timeout guidance is
  an operational answer for this turn, not a baseline architecture mechanism.
- Treat a small connection pool as a capacity limit, not as backpressure that
  makes unbounded application fanout safe.

## Verification

- Commands to run: direct Markdown readback, `pnpm docs:drift`, and
  `git diff --check`.
- Expected outcomes: the invariant is internally consistent, current-doc drift
  checks pass, and the diff contains no whitespace or accidental identifier
  leakage.

## Local evidence

- Direct readback confirmed the new section preserves required authority checks
  while making datastore, decryption, provider-call, and concurrency bounds
  explicit.
- `pnpm docs:drift` passed.
- `git diff --check` passed.
Completed: 2026-07-15
