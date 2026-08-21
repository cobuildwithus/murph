# KMS and checkpoint timeout diagnostics

Status: active
Created: 2026-08-20
Updated: 2026-08-20

## Goal

- Make transient KMS decrypt and hosted checkpoint-session timeouts diagnosable
  from secret-safe production logs without changing encryption, retry, or
  checkpoint durability behavior.

## Success criteria

- KMS retry and terminal-failure logs identify the exact auth/RPC stage,
  per-stage and total elapsed time, attempt/budget state, provider reason, and
  provider-payload byte counts without logging credentials, resource names, or
  payloads.
- Hosted checkpoint failure records identify session-start and completion
  elapsed time and distinguish write-fence, request, response-decode,
  payload-validation, and checkpoint-recording failures.
- Focused tests prove classification, bounded values, retry transport response,
  integrity-gated completion, and redaction-safe output; affected package
  typechecks pass.
- Required ReviewGPT stages and exact-head CI pass before merge and deployment.

## Scope

- In scope: hosted Web Google KMS diagnostics; Cloudflare checkpoint session
  start and completion diagnostics; focused tests and durable operational
  documentation.
- Out of scope: changing KMS cryptography or retry budgets; increasing the
  checkpoint timeout; adding another retry/queue; exposing provider payloads;
  changing checkpoint storage semantics.

## Constraints

- Technical constraints: preserve KMS buffer zeroing, integrity checks, and
  decrypt-only bounded retry; preserve runtime-wake cancellation identity and
  checkpoint fencing; emit only bounded allowlisted metadata.
- Product/process constraints: use the isolated PR lane, keep production
  evidence private, and deploy Web before Cloudflare if both surfaces change.

## Risks and mitigations

1. Risk: diagnostics accidentally expose credentials, resource names, or
   encrypted payloads.
   Mitigation: log only enums, durations, counts, byte lengths, and normalized
   provider status; assert forbidden values are absent in tests and diff review.
2. Risk: instrumentation changes cancellation or retry behavior.
   Mitigation: keep instrumentation side-effect-only and retain existing focused
   abort, retry, shared-auth-refresh, and buffer-zeroing tests.
3. Risk: checkpoint timeout wrapping hides an expected runtime-wake preemption.
   Mitigation: preserve caller-signal identity before classifying internal
   session-start failures and test both paths.

## Tasks

1. Confirm current impact and recovery state from bounded production logs.
2. Add KMS attempt/stage diagnostics and focused coverage.
3. Add checkpoint session-start failure provenance and focused coverage.
4. Run focused tests, typechecks, diff/privacy review, and update owner docs.
5. Push the exact candidate, run preliminary and final ReviewGPT with CI,
   resolve accepted findings, merge, deploy, and verify bounded live logs.

## Decisions

- KMS payload contents and key/resource names remain unavailable to logs; byte
  lengths are sufficient to disprove payload-size hypotheses.
- Do not increase the six-second checkpoint-session budget without root-cause
  proof. Instrument its substage first.
- Treat the observed checkpoint failures as a transient partial degradation:
  every affected subject later showed progress and no privacy exposure was
  observed.
- Include checkpoint completion diagnostics after bounded live evidence showed
  final publication could consume its full existing deadline even when archive
  construction and direct upload were fast.
- Keep exact inner-stage attribution for every waiter on one shared Google auth
  refresh. The identity-pool client owns one bounded, transient stage record;
  attempts retain only a reference to that record, never credentials, URLs, or
  provider payloads. Caller cancellation does not clear shared auth work.
- Treat a successful second KMS RPC only as a provider response in diagnostics.
  Decrypt recovery is not established until the existing plaintext and CRC
  integrity checks pass, so the transport-boundary log must not claim recovery.

## Verification

- Passed: `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage
  apps/web/test/hosted-crypto-gcp-kms.test.ts
  apps/web/test/hosted-crypto-gcp-kms-official.test.ts
  apps/web/test/hosted-crypto-gcp-kms-real-sdk.test.ts` (50 tests).
- Passed: `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts
  apps/cloudflare/test/runner-platform.test.ts` (195 tests).
- Passed: `pnpm exec vitest run
  packages/assistant-runtime/test/hosted-invocation-bridge.test.ts` (52 tests).
- Passed: Web, Cloudflare runner, and assistant-runtime package typechecks;
  `git diff --check`; and repository secret/direct-identifier diff inspection.
- Passed: preliminary ReviewGPT on immutable head `461eafa05a5e` returned three
  accepted coverage findings; shared-refresh provenance, installed-SDK proof,
  and post-publication checkpoint proof are resolved on the current head.
- Fixed: final ReviewGPT round 2 on immutable head `1f377fc9c3` accepted one
  installed-SDK auth-deadline failure-stage finding; active STS and service
  account impersonation deadline regressions now pass.
- Fixed: final ReviewGPT round 3 found that a second operation waiting on the
  same cold auth refresh could still report `kms_rpc`. The per-client shared
  refresh owner now exposes active subject-token, STS, and impersonation stages
  to every waiter while preserving completed-error precedence and all existing
  deadlines, retries, and cancellation behavior.
- Passed: installed-SDK shared-waiter regressions for subject-token, STS, and
  service-account impersonation deadlines; one case also expires the shared
  auth deadline before the waiter deadline. The initiating caller cancels
  without a failure log, the surviving waiter reports the exact stage and a
  bounded nonzero elapsed time, provider retries stay disabled, and secret
  values remain absent. A completed provider `DEADLINE_EXCEEDED` also preserves
  terminal STS provenance instead of consulting active deadline state.
- Passed: Web typecheck, focused ESLint, `git diff --check`, and an independent
  subagent ownership/concurrency review of the shared refresh design.
- Fixed: final ReviewGPT round 4 found that the retry info event claimed
  recovery before decrypt integrity checks and that inner-auth provenance had
  three transient owners. The event now records only provider-response receipt.
  One per-client auth-refresh context now solely owns the three inner-stage
  timings and terminal stage; error-object provenance and attempt-local inner
  timers are deleted.
- Passed: a bad-CRC second-response regression proves no recovery claim;
  installed-SDK shared refresh success followed by caller cancellation and a
  surviving KMS failure preserves bounded STS timing and `kms_rpc` attribution
  without an auth or KMS retry. Full KMS coverage passes 49/49, the installed
  SDK suite passes repeatedly, and Web typecheck, focused ESLint, and
  `git diff --check` pass on the remediation.
- Fixed: final ReviewGPT round 5 found that a surviving waiter could retain an
  exact inner-auth stage while logging an unhelpful `UNKNOWN` reason when only
  the shared auth deadline fired. The diagnostic-only normalization now reports
  `DEADLINE_EXCEEDED` for that exact case without changing the thrown provider
  error, retry eligibility, deadlines, or cancellation.
- Fixed: final ReviewGPT round 6 found that session start still collapsed a
  request that never returned headers, a stalled response body, and malformed
  JSON into one phase. Session start now mirrors completion's existing split:
  `session_start_request` owns the response-header boundary and
  `session_start_response_decode` owns the successful body and JSON boundary
  under the remaining part of the same six-second deadline.
- Passed: full KMS coverage 50/50; Cloudflare runner snapshot coverage 196/196;
  assistant-runtime checkpoint coverage 52/52; Web, Cloudflare runner, and
  assistant-runtime typechecks; `git diff --check`; direct-identifier review;
  and two independent read-only subagent audits of the Round 5 KMS correction.
- Passed: an independent checkpoint-boundary audit found no release-blocking
  implementation defect. A separate coverage audit identified four weak test
  assertions, now resolved: the no-headers case fails from the actual request
  signal; a delayed response proves body decoding receives only the remaining
  deadline; wake-first response-body cancellation preserves the exact caller
  error without diagnostic mutation; and both new phases plus HTTP status
  precedence are projected explicitly. The focused suites pass 196/196 and
  52/52 after those changes.
- Remaining: final ReviewGPT rerun, exact-head GitHub checks, merge/deploy, and
  bounded postdeploy Vercel/runtime-log queries.
