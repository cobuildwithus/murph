# runtime accepted-failure diagnostics

Status: active — local candidate complete; publication and exact-head gates pending
Created: 2026-08-09
Updated: 2026-08-09

## Goal

- Preserve a bounded, metadata-only classification of the inner runner-container
  failure through the Worker error boundary and accepted-attempt failure log.
- Make the deterministic no-progress runtime loop diagnosable without exposing
  prompts, user content, provider responses, credentials, or raw exception text.

## Success criteria

- A container job failure retains its safe categorical code/name/stage at the
  outer `runner.accepted_attempt_failed` boundary instead of collapsing to only
  `runtime_error` and HTTP 500.
- Unknown or unsafe exception values remain redacted and bounded.
- Existing recovery signaling, retry timing, foreground priority, checkpoint
  fencing, and Worker/container compatibility remain unchanged.
- Focused Cloudflare tests and typecheck pass; exact-head CI and required
  ReviewGPT gates are green before completion.

## Scope

- In scope: one shared allowlist for runtime failure phases, tagging
  otherwise-generic runtime errors with the causal phase, preserving that
  exact phase through the existing container response, and narrowly preferring
  it over the reconstructed outer `runtime_error` during redacted persistence.
- Out of scope: guessing or patching the still-unclassified inner crash,
  suppressing warning callbacks, adding retry state, changing Temporal cadence,
  or mutating production runtime state.

## Constraints

- Reuse the existing container response and safe-diagnostics contracts; add no
  new queue, scheduler, persistence owner, or compatibility service.
- Allowlist fixed-shape metadata only. Never persist exception messages, stack
  traces, prompts, provider payloads, paths, or member identifiers.
- Keep the change backward compatible while old and new Worker/container
  versions overlap during gradual rollout.

## Risks and mitigations

1. Risk: inner details accidentally expose sensitive runtime data.
   Mitigation: carry only normalized categorical fields through explicit
   allowlists and prove unsafe values are omitted.
2. Risk: changing error construction alters retry classification.
   Mitigation: preserve existing direct and nested codes, the current outer
   code/status/message, and all scheduling/recovery behavior.
3. Risk: warm old containers omit the phase tag during rollout.
   Mitigation: reuse the existing optional `errorCodeDetail` bridge so legacy
   generic failures remain valid and mixed-version behavior is unchanged.
4. Risk: preferring arbitrary nested code-shaped values could persist an
   identifier.
   Mitigation: the Worker accepts only exact shared `runtime_phase:<phase>`
   values; identifier-shaped and unknown nested values retain outer-code
   precedence and are proven absent from persisted redacted JSON.

## Tasks

1. [x] Trace the exact container response, Worker error, and redacted-log types.
2. [x] Confirm whether the existing safe diagnostic bridge is live in production.
3. [x] Tag otherwise-generic failures with the causal runtime phase and close
   handled phase state without adding routine success logs.
4. [x] Add focused phase-tagging, existing/nested-code preservation,
   exact-transport, and identifier-rejection tests.
5. [x] Run focused Assistant Runtime and Cloudflare proof and typecheck, then
   review the complete diff.
6. Push the candidate, open a draft PR, run preliminary specialists and final
   ReviewGPT concurrently with exact-head CI, and resolve accepted findings.
7. Close the plan with final exact-head evidence.

## Decisions

- This PR is diagnostics-first. A no-progress backoff or concrete runtime fix
  requires the newly preserved category and will be a separate evidence-led
  change if needed.
- Existing direct warn/error delivery remains intact because it also owns the
  current recovery callback.
- Production already carries `errorCodeDetail` into the reconstructed Worker
  error, but the shared diagnostic reader gives the outer `runtime_error` code
  precedence during final redacted persistence. The narrow shared phase
  contract fixes that last hop without changing precedence for any other code.
- The phase marker is a non-enumerable shared property separate from `.code`
  and `.errorCode`. An exact `runtime_error` detail remains generic and may
  receive a phase; every meaningful direct or nested code keeps its existing
  transport and classification.
- The Worker never interpolates an allowlisted phase into the reconstructed
  error's `Code:` message fragment. This keeps checkpoint phase names from
  changing canonical message-derived classification while preserving the phase
  in structured redacted metadata.

## Verification

- Passed the focused Assistant Runtime foreground and restore phase-tagging
  regressions (2 selected; 266 skipped) plus Hosted Execution and Assistant
  Runtime typechecks.
- Passed focused Cloudflare response-to-redacted-log transport and privacy
  regressions (2 selected; 212 skipped), then the full container-entrypoint,
  runner-container, and transport-failure slice (3 files, 264 tests), plus
  Cloudflare typecheck.
- The preliminary coverage specialist identified that the reconstructed phase
  was not asserted at the final accepted-attempt request boundary. Accepted the
  tests-only artifact after full inspection and `git apply --check`; the added
  production-faithful assertion and Cloudflare typecheck pass on the corrected
  candidate.
- Final ReviewGPT round 1 identified two accepted original-patch findings:
  generic `runtime_error` wrappers suppressed the phase, and checkpoint phase
  text could change canonical classification. The corrected design separates
  phase from canonical code and keeps phase tokens out of reclassified message
  text. Focused Assistant Runtime tests (2 selected), focused cross-boundary
  Cloudflare tests (4 selected), all three owner typechecks, and the full
  Cloudflare container/transport slice (3 files, 265 tests) pass.
- Passed `git diff --check` and parent scope/call-path review.
- Production deployment proof confirmed the existing propagation bridge is
  already live at 100%; no rollout wait or duplicate transport work is needed.
- Pending exact-head GitHub Actions and required ReviewGPT gates.
