# PR 2212 specialist recovery

Status: active
Created: 2026-08-24
Updated: 2026-08-24

## Goal

Close the accepted preliminary-review gaps in the core-runtime Vault CLI slice
without changing automation ownership or adding a second error framework.

## Evidence

- The PR claimed that an unpaired hosted `supportKind: check_in` request saved,
  while the hosted contract correctly rejected it at `supportSeriesId`.
- Assistant run results and daemon-failed events exposed raw failure prose beside
  the new bounded `lastFailure` object.
- The daemon client discarded bounded 400, 404, and 409 owner codes and labeled
  correctable input, missing-resource, and conflict failures as version skew.
- Non-null `lastFailure` had no assistantd serialization plus client-parse proof.
- Batch fallback and onboarding error surfaces still depend on the reviewed
  foundation preserving ordinary bounded diagnostics.

## Design

- Keep paired support ownership unchanged. Prove the ordinary hosted check-in
  shape by omitting both support fields, and correct the PR claim.
- Derive daemon events, legacy `lastError`, and `lastFailure` from one bounded
  outward projection. Preserve useful messages while masking only concrete
  credential/home shapes through the shared foundation.
- Read only the bounded code from non-5xx assistantd error JSON. Map known
  owner codes and safe status classes to accurate recovery; ignore response
  prose and keep unknown 5xx failures generic.
- Reuse the existing assistant run schema for the non-null HTTP/client round
  trip. Add no parser service, retry manager, or persisted state.

## Tasks

1. Correct hosted automation proof and PR purpose claims.
2. Fix daemon failure projection and HTTP status/code recovery.
3. Prove non-null `lastFailure` serialization and client parsing.
4. Integrate the exact reviewed diagnostic foundation and prove batch/onboarding
   composition preserves bounded ordinary messages.
5. Run focused tests, affected typechecks, prepared/package/bundle gates, push
   the Draft candidate, and run the required exact-head reviews with CI.

## Progress

- Hosted weekly cron/timezone proof now distinguishes a valid ordinary check-in
  with both support-owner fields omitted from the intentionally rejected
  unpaired `supportKind` request.
- The daemon client retains bounded owner codes for invalid runtime/state ids,
  missing sessions/jobs, vault mismatch, and conflict; response prose and 5xx
  bodies remain non-authoritative.
- Daemon failure events, `lastError`, and `lastFailure` derive from one bounded
  projection, and non-null `lastFailure` is covered at assistantd serialization
  and daemon-client parsing boundaries.
- Focused hosted-tool, assistantd HTTP, daemon-client, and run-loop suites pass;
  assistant-engine, assistantd, and assistant-cli typechecks pass.
- Final ReviewGPT round 1 returned one accepted `Complexity Collapse`: nine
  automation path mappers repeated the same finite owner vocabulary. They now
  converge on one private `automationIssuePublicPath` and the existing
  `publicValidationIssue` constructor. Production source deletes 91 net lines
  without adding a public seam or changing command behavior.
- The consolidated mapper rejects arbitrary validator paths while preserving
  schedule-kind fields, route/target fields, bounded tag and context-reference
  indices, and payload-root prefixes. The complete automation suite passes
  32/32, CLI typecheck passes, and `git diff --check` is clean.
- Final foundation composition, prepared/package/bundle proof, and exact-head
  review remain pending.
