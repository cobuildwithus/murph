# Linq attachment delivery recovery

Status: completed
Created: 2026-08-06
Updated: 2026-08-07

## Goal

- Make private generated-image delivery recover automatically from safely
  replayable Linq byte-upload failures while failing closed on ambiguous
  attachment reservation, without regenerating the canonical image, widening
  retry policy for unrelated POST operations, or introducing another queue or
  state owner.

## Success criteria

- A retryable confirmed presigned-upload failure is retried only inside the
  current dispatch with the same canonical `vault_image`, reservation, URL,
  headers, and byte snapshot; exhaustion cannot restart reservation through a
  later outbox dispatch.
- An ambiguous attachment-reservation failure never blindly repeats a
  potentially completed non-idempotent provider effect unless the provider
  contract or a narrower reconciliation proof makes that safe.
- Secret-safe hosted diagnostics distinguish reservation, upload, and final
  message-send failures and retain timeout/transport classification without
  message content, provider paths, private identifiers, or credentials.
- Direct tests prove successful recovery, bounded attempts, stable artifact
  reuse, and fail-closed ambiguous-delivery behavior.
- Required exact-head ReviewGPT and CI gates complete with no unresolved
  findings.

## Scope

- In scope: Linq attachment creation/upload retry classification, the existing
  assistant outbox recovery path, structured runtime-log projection, focused
  unit/integration tests, and the owning reliability documentation.
- Out of scope: automatic group failure notices, image regeneration, a new
  scheduler or persisted state owner, public image URLs, broad POST retry
  policy, or unrelated messaging transports.

## Constraints

- Reuse the canonical vault image, current outbox lifecycle, and stable
  delivery identity.
- Preserve the invariant that an ambiguous non-idempotent provider call cannot
  be blindly replayed.
- Keep observability best-effort and off the user-facing delivery path.
- Prefer deletion or a narrow policy correction over a new abstraction.

## Production evidence

- Two image-provider calls completed successfully in the affected turn.
- The first delivery failed before Linq returned a response to attachment
  creation and was classified terminal after one attempt.
- A later delivery through the same route succeeded, and no other matching
  attachment-creation failure appeared in the bounded production window.
- Existing logs preserve the high-level operation but discard enough safe
  transport classification to distinguish DNS, TLS, socket, and worker aborts.

## Tasks

1. [complete] Delegate an evidence-backed implementation patch to ReviewGPT.
2. [complete] Inspect the returned patch and align it with current owner and
   provider ambiguity contracts.
3. [complete] Run focused recovery, logging, typecheck, and direct call-path
   proof.
4. [complete] Resolve the accepted preliminary and final-round findings,
   push the corrected candidate, and complete final ReviewGPT and exact-head CI
   gates.
5. [complete] Close the plan through the scoped final commit path.

## Decisions

- Do not add automatic group failure notices; the requested recovery is silent
  transport recovery of an already-authorized reply.
- Do not regenerate an image to recover delivery. The canonical capture and
  hash-bound response-media descriptor are the existing source of truth.
- Treat provider documentation as insufficient evidence for blindly retrying
  a lost-response attachment-creation POST; ReviewGPT must either find a safe
  existing retry seam or preserve confirmation-pending behavior for that case.
- Accept the preliminary specialist finding that local retryability escaped
  into the persisted outbox. Keep retryability inside the confirmed `PUT`
  loop, terminalize exhaustion to the outer dispatch, and classify attachment
  preparation before the final message-send ambiguity boundary.
- Accept final round 1's foreground-latency finding. Keep the whole presigned
  `PUT` sequence inside the existing 30-second operation budget so retries are
  available only after fast failures and cannot add minutes of head-of-line
  blocking for newer accepted input.
- Extend that single budget through retryable HTTP error-body reads. A stalled
  body must not outlive the upload deadline or allow a zero-delay retry to
  start after the deadline; one sequence-level abort owner is both simpler and
  stricter than per-attempt deadline bookkeeping.
- Accept final round 2's repeated-owner finding. A required-send cron occurrence
  must consume a terminal confirmed attachment `PUT` outcome instead of using
  the failed outbox intent as permission to create a successor intent and a
  fresh reservation. Preserve the complete existing delivery error through
  cron reconciliation and reuse the existing fresh-intent prohibition policy.
- Keep reservation `POST` outcomes fail-closed for transport loss, timeout,
  HTTP 408, and HTTP 5xx. No provider evidence proves those responses imply
  that the non-idempotent reservation effect did not begin.
- The required anomaly retrospective chose justified continuation: this is the
  same indivisible no-replay requirement, current source shape remains far
  below the churn threshold, and the correction tightens existing owner
  boundaries without adding state, a queue, or a lifecycle.
- Accept final round 3's provenance finding. Preserve explicit provider-skipped
  evidence when the hosted boundary defers before the reservation fetch, and
  treat every successful but unusable reservation response as ambiguous. Both
  corrections reuse the existing prepared intent and terminal ambiguity owner;
  they add no state, queue, or transport-wide retry policy.
- Accept the follow-up specialist's cumulative-provenance finding and the final
  round-2 retrospective decision. `attemptedAt` remains the sole cumulative
  provider-entry owner: before the first private-media reservation, fresh-input
  preemption keeps the same intent pending; after that reservation enters, any
  later defer—including between reservations or after the last upload before
  the final message—carries only transient reservation provenance through the
  Linq wrapper and terminalizes the existing occurrence through the outbox
  ambiguity owner. The shared private-image/private-file seam gets one
  production-owner fixture; no durable state or retry owner is added.
- Parent verification found that Linq's ordinary idempotent message retry loop
  initially treated the post-reservation foreground-preemption marker as a
  network failure. Preserve the marker but classify that specific control-flow
  exception non-retryable inside Linq, so it reaches the existing outbox
  ambiguity owner immediately without changing ordinary message retry policy.
- Product revalidation: the smallest complete experience remains silent and
  single-owner. Before reservation, fresh foreground work pauses the same
  prepared intent; after reservation, the occurrence fails closed rather than
  risking a duplicate attachment. No user-facing failure notice, regeneration,
  or new recovery surface is introduced.
- Accept final round 3's direct-materialization provenance finding. The existing
  redacted-target recovery wrapper converted every transport-shaped error to
  generic confirmation-pending state and erased the transient cumulative
  reservation marker. Rethrow only that marked error unchanged before the
  generic conversion, preserving the existing metadata and outbox ambiguity
  owner while leaving all unmarked direct-thread recovery behavior intact.
  ReviewGPT's production hunk is unchanged; parent validation narrowed its
  total-fetch assertion to ignore the existing best-effort typing cleanup.
- Accept final round 4's symmetric pre-provider finding. The same wrapper also
  converted explicit `deliveryMayHaveSucceeded: false` provenance before the
  first reservation into generic confirmation-pending state. Rethrow that
  explicit false fact unchanged before generic conversion, so the existing
  callback resets the same prepared intent immediately; unmarked transport
  failures retain the established confirmation-pending policy. This completes
  the retrospective's single before/after-reservation rule without new state.
- Accept final round 5's successful-reservation header finding. Normalize and
  reject empty or all-blank required upload headers inside the reservation
  parser, where the actual 2xx status and attachment-POST provenance remain
  available. Reuse the existing unusable-reservation wrapper and ambiguity
  owner; add no cron exception or successor retry path.
- Accept final round 6's complexity-collapse finding after current `main`
  established exact pre-provider `Error` identity as the owner. Delete the
  redundant field-by-field reconstruction for unsupported non-`Error` throws,
  leaving `readPreProviderLinqRequestError` as the single pre-provider path and
  retaining the independent post-reservation marker. ReviewGPT implemented the
  one-file net deletion, and round 7 passed the exact remediation head.

## Verification

- `pnpm exec vitest run --config vitest.config.ts --no-coverage test/http-linq-device-runtime.test.ts`
  from `packages/operator-config`: 53 tests passed.
- `pnpm exec vitest run --config vitest.config.ts --isolate=true --no-coverage test/hosted-runtime-workspace-assistant-phase.test.ts`
  from `packages/assistant-runtime`: 276 tests passed.
- `pnpm --dir packages/operator-config typecheck`: passed.
- `pnpm --dir packages/assistant-runtime typecheck`: passed.
- `pnpm exec vitest run --config vitest.config.ts --no-coverage test/assistant-outbox-runtime.test.ts`
  from `packages/assistant-engine`: 92 tests passed.
- `pnpm exec vitest run --config vitest.config.ts --isolate=true --no-coverage test/hosted-runtime-callbacks.test.ts`
  from `packages/assistant-runtime`: 213 tests passed.
- `pnpm --dir packages/assistant-engine typecheck`: passed.
- `pnpm exec vitest run --config vitest.config.ts --no-coverage test/assistant-vault-file-send.test.ts`
  from `packages/assistant-engine`: 26 tests passed.
- `pnpm exec vitest run --config vitest.config.ts --no-coverage test/assistant-channels-runtime.test.ts`
  from `packages/assistant-engine`: 60 tests passed.
- `pnpm exec vitest run --config vitest.config.ts --no-coverage test/assistant-outbox-retry-policy.test.ts test/assistant-outbox-runtime.test.ts`
  from `packages/assistant-engine`: 102 tests passed.
- `pnpm exec vitest run --config vitest.config.ts --no-coverage test/assistant-cron-runtime.test.ts`
  from `packages/assistant-engine`: 201 tests passed.
- `pnpm --filter @murphai/operator-config exec vitest run test/http-linq-device-runtime.test.ts --reporter=dot`:
  56 tests passed after final-round provenance remediation.
- `pnpm --filter @murphai/assistant-runtime exec vitest run test/hosted-runtime-linq-outbox-regression.test.ts --reporter=dot`:
  3 tests passed through the real hosted adapter/outbox boundary.
- `pnpm --filter @murphai/assistant-runtime exec vitest run test/hosted-runtime-callbacks.test.ts --reporter=dot`:
  215 tests passed.
- `pnpm --filter @murphai/assistant-engine exec vitest run test/assistant-outbox-runtime.test.ts test/assistant-outbox-retry-policy.test.ts test/assistant-cron-runtime.test.ts --reporter=dot`:
  306 tests passed.
- `pnpm --filter @murphai/operator-config typecheck`,
  `pnpm --filter @murphai/assistant-engine typecheck`, and
  `pnpm --filter @murphai/assistant-runtime typecheck`: passed.
- Follow-up ReviewGPT implementation proof:
  `pnpm --filter @murphai/assistant-runtime exec vitest run test/hosted-runtime-linq-outbox-regression.test.ts --reporter=dot`:
  5 tests passed, including cumulative multi-image provider entry and malformed
  successful reservation JSON.
- Follow-up callback proof:
  `pnpm --filter @murphai/assistant-runtime exec vitest run test/hosted-runtime-callbacks.test.ts --reporter=dot`:
  215 tests passed; assistant-runtime typecheck passed.
- Follow-up engine owner proof ran 306 tests with 305 passing and one unrelated
  retention test timing out under concurrent load; the exact timed-out test
  passed in isolation on immediate rerun.
- Final implementation proof:
  `pnpm --filter @murphai/assistant-runtime exec vitest run test/hosted-runtime-linq-outbox-regression.test.ts --reporter=dot`:
  7 tests passed, including private image and approved private file at the
  post-upload/pre-final-message boundary with no later reservation.
- Final Linq transport proof:
  `pnpm --filter @murphai/operator-config exec vitest run test/http-linq-device-runtime.test.ts --reporter=dot`:
  57 tests passed, including immediate propagation of post-reservation
  foreground preemption without local message retry.
- Final owner suites: hosted callbacks 215/215 and assistant-engine
  outbox/retry/cron 306/306 passed.
- Final package typechecks for operator-config, assistant-engine, and
  assistant-runtime passed.
- Direct-materialization remediation proof: hosted provider effects 20/20 and
  the real hosted Linq outbox matrix 8/8 passed, including the redacted target,
  proved same-wake routes, one reservation/PUT, no final `/chats` request, and
  no later successor reservation.
- Post-remediation owner suites passed again: hosted callbacks 215/215, Linq
  transport 57/57, and assistant-engine outbox/retry/cron 306/306.
- Post-remediation package typechecks for operator-config, assistant-engine,
  and assistant-runtime passed.
- Pre-provider direct-materialization remediation proof: hosted provider effects
  21/21 and the real hosted Linq outbox matrix 9/9 passed. The redacted route
  makes no reservation, upload, or final chat request before defer, resets the
  same intent, then sends it once on the later non-yielding drain with no
  successor intent.
- Final owner suites passed again after that patch: hosted callbacks 215/215,
  Linq transport 57/57, assistant-engine outbox/retry/cron 306/306, and all
  three package typechecks.
- Empty/all-blank reservation-header remediation proof on the merged candidate:
  Linq transport 64/64, real hosted Linq outbox 10/10, hosted provider effects
  21/21, hosted callbacks 227/227, assistant cron 205/205, assistant outbox
  runtime 95/95, retry policy 7/7, dispatch state 28/28, and all three package
  typechecks passed.
- ReviewGPT round 6 found only redundant pre-provider reconstruction introduced
  by the current-main ownership direction. ReviewGPT's exact one-file
  implementation removed 58 lines and added two direct references. Parent
  validation passed Linq transport 64/64, hosted provider-effects plus real
  hosted-outbox regressions 31/31, operator-config typecheck, assistant-runtime
  typecheck, and `git diff --check`.
- ReviewGPT round 7 returned `ROUND_OUTCOME: PASS` on exact source head
  `d31fea80de229e022683e2d19d42cb5b871bfdcb`; no unresolved correctness,
  reliability, privacy, product-experience, coverage, purpose-drift, or
  material-simplification finding remained.
- Every required GitHub check passed on that exact source head, including the
  aggregate release gate, host matrices, package/app/fixture coverage, build
  and typecheck, repository hygiene, frontend proof, viewport overflow, and
  Vercel.
Completed: 2026-08-07
