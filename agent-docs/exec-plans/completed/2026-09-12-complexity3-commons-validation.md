# Simplify generated Commons artifact validation through Pro

Status: completed
Created: 2026-09-12
Updated: 2026-09-12

## Outcome and protected invariants

Reduce repeated validation in the generated Health Commons runtime without changing accepted artifacts, rejected artifacts, diagnostics, returned values, or authored health content. Keep generated projection ownership, route identity, strict research-study keys, safe source URLs, optional/null distinctions, and numeric validation semantics unchanged.

## Evidence and scope

At creation base `486a6595e51bff2a6cfa64beb4ee1a953854a8b6`, the parent complexity inventory reports `packages/health-commons/src/runtime.ts` debt 60 and maximum 43. Generated web research, protocol, and index validators repeat optional scalar and array checks. The existing file-local predicates and public artifact loaders provide the maintainable seam; this task does not need another schema engine, state owner, or dependency.

Own only the runtime validators and focused runtime validation tests. Do not change authored content, research interpretation, health thresholds, schema versions, generation, route resolution, caching, filesystem policy, or public exports.

## Implementation ownership

GPT-6 Pro implemented the source and focused tests through ReviewGPT. The root verified model and response identity and retrieved `complexity3-commons-validation.patch`. The local agent verified SHA-256 `2da72aa24b9e9b4180d39e700ee82039596a516e292743f2be63826aa48049fc`, applied the exact patch, and confirmed reverse-apply validation. No local source/test redesign was made.

## Proof and completion

1. Ask Pro for a coherent reduction of duplicated validation and focused public-loader regression tests using synthetic artifact roots.
2. Audit the returned patch for exact acceptance/rejection, diagnostic precedence, scope, privacy, and genuine simplification.
3. Run the new focused suite plus existing runtime tests, relevant package typecheck, and the complexity guard; use normal package generation for existing artifact-dependent tests.
4. Parent owns candidate review, scoped completion, draft PR evidence, Ready, final ReviewGPT, and exact-head CI.

## Current evidence

- New `runtime-validation.test.ts`: 190 tests passed through the public native loaders using synthetic artifact roots.
- Existing `runtime.test.ts` and `runtime-paths.test.ts`: 51 tests passed. All three suites used one worker.
- `pnpm --filter @murphai/health-commons typecheck`: passed, including normal package generation; compiler used one checker.
- Complexity guard against the creation base passed: debt 60 to 28, maximum 43 to 31. Remaining hotspots: research-study validator 31, untouched compact projection 29, protocol-tab validator 24, experiment-index entry 24. Domain constraints remain explicit; no further arbitrary extraction is justified within this seam.
- Full production and test diff inspected for validation equivalence and privacy. Tests preserve strict research keys, optional/null boundaries, URL restrictions, diagnostic stages, raw numeric acceptance, and compact artifact search-text distinctions.
- Default-store frozen install and `scripts/frog list` passed. No new friction entry was needed.
- Implementation and local proof are complete. Parent owns final candidate review, Ready, final ReviewGPT, and exact-head CI. Generated output remains ignored and outside the commit.
Completed: 2026-09-12
