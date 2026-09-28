# Classify hosted completion receipts without changing execution

Status: active
Created: 2026-09-28
Updated: 2026-09-28

## Goal

Stop reporting a late, obsolete completion callback as an operational failure,
while keeping genuinely unconfirmed completion visible. Preserve all execution,
recovery, write-fence and privacy behavior.

## Success criteria

- Synthetic composed proof distinguishes recorded completion, an already
  completed/released generation, a successor, and actual uncertain outcomes.
- The response's existing completed boolean, mutations, call counts, timeout,
  result ordering, and recovery callback stay unchanged.
- Old/new Worker and warm-container response readers interoperate; missing or
  unknown diagnostics cannot suppress a warning.
- Focused proof, relevant typecheck/lint, parent inspection, final ReviewGPT
  on the pushed candidate and required CI pass before PR completion.

## Scope

- In scope: bounded diagnostic classification at the current route, native
  receipt owner and client; focused tests and the existing operational docs.
- Out of scope: delivery inference, retries, longer deadlines, moving/removing
  the callback, ownership transitions, persisted history and unrelated failures.

## Evidence and current owners

The entrypoint returns its successful invocation result before the finally
callback. The native supervisor can complete and release the exact Postgres
owner first, clearing its attempt ID. The late callback's owner guard returns
completed:false and the client logs the same warning used for missing receipts
or transport failure. Composed synthetic tests prove the ordering; a matching
native receipt is already idempotent. Postgres remains canonical authority and
RunnerContainer retains exact native invocation evidence.

## Architecture decision

Derive the diagnostic from existing decisions and owner state. Deleting the
callback would lose activation/response-loss recovery. Moving it before the
result would add latency. Neither is justified. No new state, queue, service,
read, mutation, retry, timeout or general abstraction is permitted. Diagnostic
values must be typed and closed; a later generation means superseded, not proof
of delivery. Unknown outcomes retain warnings.

## Risks and mitigations

- False reassurance: require actual completion evidence for completion labels;
  keep supersession distinct and unknown/refused native outcomes at warning.
- Deploy skew: optional additive diagnostics, old boolean-only responses stay
  accepted; unrecognized diagnostics remain conservative.
- Authority regression: preserve exact predicates and original completed values,
  prove unchanged call counts and no stale mutation.
- Privacy/cost: reuse one structured record and existing correlation, without
  private content or new I/O.

## Tasks

1. ReviewGPT supplies the bounded implementation; parent inspects its patch.
2. Run before/after regression, focused tests, typecheck, lint and complexity.
3. Document actual compatibility and operational semantics, commit/push draft,
   review the ready candidate with ReviewGPT concurrently with required CI.
4. Close the plan and report the final PR status and remaining evidence gaps.

## Ownership and product impact

Primary dirty contact-card work is preserved. This task owns its isolated
checkout. Existing latency PR changes provider authorization/timing, not this
classification; snapshot retry has a separate owner. Internal telemetry only:
no member-visible behavior, prompt, provider input, UI or changelog change.

## Verification

Baseline: all 13 existing completion/native-receipt/owner tests pass, and the
Cloudflare package typecheck passes. Frozen dependency installation and Web
Prisma generation are complete. ReviewGPT supplied the implementation; parent inspection is complete.

Baseline diagnostic proof from the investigation
includes callback-first, released-owner, successor, native rejection and a
successful response slower than the unchanged one-second budget. Final checks
will exercise the production owners and mixed response shapes.


Candidate evidence:
- All 738 focused tests pass across the completion client, router, native receipt,
  canonical owner, outer supervisor, entrypoint and abort lifecycle.
- The two obsolete callback regressions fail on the original production source;
  restoring the patch passes. Unknown/native/canonical failures remain warnings.
- Cloudflare typecheck, docs drift and gardening pass. No app-local lint command
  is defined for this owner. Whitespace validation passes.
- Complexity guard passes for all four source files. The three existing
  RunnerContainer hotspots (72, 31, 24) are unchanged, outside receipt handling;
  changing them would broaden this telemetry-only correction.
- Parent review confirms no new I/O, state, retries, deadline changes or authority
  mutations. Existing result, request and cleanup behavior remains intact.
- New reader accepts old booleans and drops unknown diagnostic text. Original
  reader validates only completed, so additive reasons remain accepted.

Final pushed-head ReviewGPT and required CI remain pending. This change does not
resolve transport timeouts or prove message delivery. Follow-up telemetry should
aggregate runtimeCompletionReceiptOutcome and runtimeCompletionReceiptReason,
keeping timeout exceptions separate and correlating accepted work with durable
outcomes only through approved read-only diagnostics.
