# Distinguish connected-app transport failures

Status: completed
Created: 2026-10-10

## Outcome

Distinguish SDK timeout, abort and network failures in existing private route
error diagnostics, without changing connected-app behavior or model input.

## Scope and proof

- Reuse the Composio request error owner and existing route logger.
- Closed categories only; no provider prose, URLs, identifiers or payloads.
- Preserve success, response body/status, retryability, provider call count,
  cause chains and ambiguous write handling. No extra events or awaited work.
- ReviewGPT implements; parent validates synthetic before/after and privacy.
- Run focused tests, Web typecheck, complexity/docs/privacy and exact-head CI.
- Final ReviewGPT and green gates precede any authorized telemetry-only merge.

## Ownership and evidence

The failed-tool investigator's inspected PR 4120 owns meal field/photo rejection
attribution. It explicitly leaves opaque connected-app transport failures open;
this request owns their provider error classification, with no competing patch.
A synthetic composed service-to-HTTP proof shows DNS failure and socket reset
produce identical private logs while each preserves one fetch and retryable503.

## Progress

- Baseline reproduction passed: distinct causes are lost by route logging.
- Public source and synthetic acceptance criteria sent to ReviewGPT.

- ReviewGPT authored six closed categories and real client/service/HTTP tests.
- Final synthetic regressions on the unchanged source: ten failures and 36 passing
  controls. Corrected four-suite result: 90 tests pass. Web typecheck passes.
- Installed SDK timeout normalization is covered explicitly; the category means
  SDK classification, not proof that the configured deadline elapsed.
- Parent candidate review: Ready. Existing private error only, eight-node limit,
  no new event, I/O, model input, public response, retry, or state change.
- Privacy/docs/complexity guards pass. Final ReviewGPT PASS on
  13df3f7648b427282efab13a7832d2f84254630b, with no qualifying findings.
- Parent final review: Ready. Reviewed source, tests and owner documentation
  remain unchanged by this explanatory plan/index closeout.
- Required final-head CI remains pending and gates telemetry-only merge.
- Production verification must confirm managed admission, serving source and
  natural diagnostic observations; no synthetic provider activity is authorized.
Updated: 2026-10-10
Completed: 2026-10-10
