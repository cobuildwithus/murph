# PR 2212 specialist recovery

Status: active
Created: 2026-08-24
Updated: 2026-08-25

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

## Round 2 retrospective

- Invariant: only replay-safe daemon reads may advertise blind retry. A failed
  effectful request whose completion is unknown must be terminal and instruct
  the caller to inspect canonical state before deciding what to do next.
- Root cause: the accepted round-one daemon retry finding was not actually
  corrected. `assistantDaemonFetchJson` still discarded the request method when
  classifying fetch, response-body, and HTTP failures, and its GET-only stream
  test preserved the universal-retry assumption. The later bounded owner-code
  work improved diagnostics but did not change this mechanism.
- Owner decision: keep completion certainty at the existing daemon client
  boundary. Pass the existing `GET | POST` method into its two private failure
  constructors; retain retry only for GET transport and transient HTTP classes,
  and classify POST transport/response uncertainty as terminal inspect-first.
- Scope decision: keep the verified automation-mapper consolidation and shared
  batch envelope in this PR. Splitting the daemon correction would leave the
  PR's recovery contract false and duplicate its exact-head verification; the
  correction is a small change inside the already-owning client.
- Complexity decision: add no route table, retry manager, idempotency key,
  persistence, reconciliation loop, compatibility layer, or second error
  framework. Delete the universal retry assumption at its one current owner and
  prove both the effectful POST and replay-safe GET paths.

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
- Current `main` through `52205b8c56` is integrated at merge candidate
  `9faa1f7e14`. Shared projector and unrelated CLI owners come from `main`;
  only the PR-owned daemon, automation, batch, and vault-initialization behavior
  is composed. The resulting domain diff is 32 files.
- Batch recovery now extends the existing operator-config batch envelope rather
  than retaining the branch's duplicate result schema. The shared schema owns
  bounded structured errors and permits empty argv for failures before command
  parsing. Incur configuration, command metadata, and skill hash were regenerated.
- Current-main proof passes: automation and batch 43/43, Vault Usecases 8/8,
  affected operator-config/Vault Usecases/CLI typechecks, prepared runtime, CLI
  package shape, docs drift/gardening, and the canonical runner assembly with
  all eight parity probes. Vault CLI is 9,533,986 / 9,534,735 bytes with an
  805-byte entry and 25,155-byte static closure; runner total is
  11,365,094 / 11,393,617 bytes.
- Exact-head final review remains pending.
- Final ReviewGPT round 2 returned `RETROSPECTIVE_REQUIRED`: the exact head still
  marks transport and transient HTTP failures retryable for every method. The
  finding is accepted; the retrospective above was recorded before remediation.
- The correction passes the existing method into both private classifiers.
  Transient GET failures retain retry guidance; POST fetch, body-read, and
  transient HTTP failures return terminal `assistant_daemon_completion_unknown`
  with inspect-first guidance. The `/message` response-loss test records one
  completed effect and proves no replay or raw failure echo; the POST 502 and
  existing GET transport tests cover the other classification branches.
- The assistant-cli focused suite passes 13/13 and its typecheck passes.
