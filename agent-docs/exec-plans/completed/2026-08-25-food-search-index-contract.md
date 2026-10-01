# Enforce the private food-search index contract

Status: completed
Created: 2026-08-25
Updated: 2026-08-25

## Goal

- Stop private food-name searches from reaching PostgreSQL's eight-second
  statement timeout because a production labels database is missing the three
  indexes required by the deployed bounded query.
- Make future production builds fail closed on missing, invalid, unready, or
  wrongly defined search indexes, and add query-free failure context that makes
  a remaining timeout diagnosable without exposing member search text.

## Success criteria

- The production preflight validates the exact three private-food search index
  contracts as well as the existing column contract.
- A dedicated concurrent-index SQL entrypoint gives operators a live-safe path
  for installing the missing indexes before deployment.
- GET and batch POST failures identify lookup shape, bounded cardinality, and
  elapsed time without logging query values.
- Focused Web tests and typecheck pass; the PR receives required ReviewGPT and
  exact-head CI proof.

## Scope

- In scope: product-label schema preflight, focused schema tests, the concurrent
  foods-index rollout SQL, product-label route error diagnostics, and operator
  documentation.
- Out of scope: changing the eight-second timeout, storing search terms,
  automatically mutating the external labels database during a Web build, or
  changing public/supplement search ranking.

## Constraints

- Technical constraints: runtime credentials remain read-only; index creation
  is concurrent and outside a transaction; exact index semantics and live
  validity/readiness must be checked rather than trusting names alone.
- Product/process constraints: preserve deterministic private-food ranking,
  fail closed before a deploy when prerequisites are absent, and keep all
  production evidence aggregate and privacy-safe.

## Risks and mitigations

1. Risk: a same-named but incorrect or interrupted concurrent index could pass
   a shallow existence check.
   Mitigation: validate the normalized `pg_get_indexdef` suffix plus
   `indisvalid`, `indisready`, and `indislive`.
2. Risk: richer failure logs could expose food queries.
   Mitigation: record only operation type, booleans, bounded counts/lengths,
   limit, and elapsed milliseconds.

## Tasks

1. Add focused failing tests for missing, invalid, and wrong-definition index
   states and privacy-safe GET/POST diagnostics.
2. Extend the build-time product-label preflight and add the concurrent index
   rollout entrypoint.
3. Update the live operator contract, run focused tests/typecheck, and inspect
   the final diff.
4. Commit, push, open the PR, then run preliminary and final ReviewGPT alongside
   required exact-head CI.

## Decisions

- Production read-only proof on 2026-08-25 found a 2.04M-row foods table and
  none of the three required indexes. Exact application calls reproduced
  statement timeouts for several ordinary broad private searches, while the
  generic-only path stayed well below one second.
- The correction enforces the already-documented index-backed architecture
  rather than raising the timeout or weakening deterministic ranking.

## Verification

- Commands: focused product-label runtime-env and route tests, Web typecheck,
  SQL contract readback, `git diff --check`, ReviewGPT, and required PR checks.
- Expected outcomes: all focused tests and typecheck pass; no diagnostic
  contains a query value; production deployment remains blocked until the
  concurrent index rollout has completed and the preflight sees live indexes.
- Local evidence: 91 focused Web tests passed across the preflight, food route,
  supplement route, and food-query suites; `pnpm typecheck` passed in
  `apps/web`; the updated preflight ran through the production Vercel
  environment and rejected the live labels database for exactly the three
  missing search indexes without printing credentials or row data.
Completed: 2026-08-25
