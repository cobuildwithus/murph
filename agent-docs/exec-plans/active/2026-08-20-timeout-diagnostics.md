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
- Focused tests prove classification, bounded values, retry recovery, and
  redaction-safe output; affected package typechecks pass.
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

## Verification

- Passed: `pnpm exec tsx apps/web/scripts/run-hosted-web-vitest.mts
  apps/web/test/hosted-crypto-gcp-kms.test.ts
  apps/web/test/hosted-crypto-gcp-kms-official.test.ts
  apps/web/test/hosted-crypto-gcp-kms-real-sdk.test.ts` (43 tests).
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
- Passed: an independent two-agent remediation review found no release blocker.
- Remaining: final ReviewGPT rerun, exact-head GitHub checks, merge/deploy, and
  bounded postdeploy Vercel/runtime-log queries.
