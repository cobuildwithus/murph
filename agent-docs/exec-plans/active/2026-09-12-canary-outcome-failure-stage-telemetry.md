# Classify canary outcome read failures

Status: active
Created: 2026-09-12
Updated: 2026-09-12

## Goal

Distinguish which existing stage failed during a fixed-identity canary outcome
read while retaining the current private-safe HTTP response and read-only flow.

## Success criteria

- Failures emit one bounded stage diagnostic with no private values or causes.
- Successful and ordinary not-ready reads emit no diagnostic.
- Response, authorization, reads, retries and scheduling remain unchanged.
- Actual-reader tests cover competing boundaries, privacy and logger failure.
- Parent review, final ReviewGPT and exact-head required CI pass.

## Scope and constraints

Only the existing Web canary outcome reader, focused tests and its durable
observability owner. No provider calls, production data mutation, schema,
state owner, retry, release guard, or user-facing behavior changes. Other
route-authority telemetry and release recovery work retain separate ownership.
Production telemetry rollout requires canonical release authority and must not
release unrelated functional changes.

## Risks and mitigation

A cause can contain private replica refs or key material: record only a closed
literal stage and never retain, inspect or serialize the caught error. Logging
must not replace the existing 503. Stage tracking remains per request so
concurrent observations cannot contaminate one another.

## Tasks

1. Request minimal implementation from ReviewGPT with synthetic context.
2. Inspect patch and prove response, privacy, success and not-ready invariants.
3. Run focused tests, Web typecheck, documentation and complexity checks.
4. Push a scoped draft PR, review the candidate and mark Ready.
5. Complete final ReviewGPT concurrently with exact-head required CI.
6. Close plan, recheck final head, and evaluate canonical rollout eligibility.

## Decisions

- Existing baseline reader tests pass and confirm multiple paths share one 503.
- Preserve the existing read sequence and response contract; stage metadata is
  observability only and cannot become an outcome or authorization input.
- No changelog: internal failure classification has no member-visible change.

## Verification

- Baseline existing outcome-reader suite: 18 passed on production-equivalent source.
- ReviewGPT implementation completed with concrete gpt-6-pro model metadata;
  exact captured inline patch matches the declared attachment SHA-256. Existing
  Frog issue #2440 covers the attachment-identity failure; no duplicate entry.
- New tests against unchanged source: 19 diagnostic assertions failed and 18
  compatibility checks passed. Patched reader and route suites: 46 passed.
- Web typecheck, raw-health-log guard, whitespace and complexity checks passed.
  Maximum complexity is 19; no functions exceed 20 and no debt was added.
- Parent candidate review passed: unchanged operation order/count, generic error,
  access/race/freshness gates and success/not-ready results. Local literal stage
  data is the only added observation; no private exception inspection.
- Documentation gardening passed; final ReviewGPT/exact-head CI: pending.
