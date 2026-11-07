# Preserve Linq attachment failure diagnostics across the runtime-log boundary

## Outcome
Ensure existing attachment-download diagnostics conform to the existing runtime-log parser. Preserve attachment fetching, errors, retries, and privacy validation.

## Plan
- [x] Trace the producer and strict consumer; inspect overlapping PR behavior.
- [x] Reproduce the rejected field with synthetic composed producer/parser proof.
- [x] Obtain a minimal ReviewGPT correction and run focused proof and typecheck.
- [ ] Complete parent review, scoped commit, final ReviewGPT and exact-head CI.
- [ ] Merge, deploy, and observe through the original automation session.

## Evidence
The attachment error producer copies `errorMessage` into redacted JSON. The runtime-log parser intentionally forbids that raw-text key. Tests previously asserted producer fields without applying the consumer parser. No private production content belongs in this plan or review packet.

Product UX: Internal diagnostics only; no provider-visible input or attachment delivery behavior changes. Changelog is not applicable.

## Verification and handoff
The real producer/parser reproduction fails three original tests; expanded proof fails six cases against unchanged source. The ReviewGPT correction changes two production lines to the existing safeErrorMessage key. All 33 attachment tests pass after correction, as do assistant-runtime typecheck and the complexity ratchet (existing hotspot 37 and debt 17 unchanged). Parent review confirms no consumer relaxation, extra calls, retry changes, or new abstraction.

Implementation is complete. The original automation session owns final pushed-head ReviewGPT, exact-head CI, merge, deployment and observation. Automation memory holds private aggregate evidence and follow-up timing.
Status: completed
Updated: 2026-10-21
Completed: 2026-10-21
