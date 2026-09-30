# Junction timeout headroom and failure diagnostics

Status: active
Created: 2026-09-30
Updated: 2026-09-30

## Goal

Outcome: give slow connected-device responses 50% more time within existing bounded collection work.
Reaches: Junction full-job summary, coupled summary, timeseries, and inventory requests.
Proof: synthetic boundary/cancellation tests and final failure-log projection tests.

## Success criteria

- Ordinary full-job request caps rise from 8 to 12 seconds; coupled summary caps rise from 5 to 7.5 seconds.
- Existing timeout failure events expose bounded timing and request-stage metadata without private content.
- Foreground cancellation, pagination bounds, retry ownership, and canonical imports remain intact.
- Focused validation, scoped PR, and required pushed-head review/CI complete; no merge or deployment.

## Scope

One focused continuation of the admitted investigation; no additional production sweep. ReviewGPT authors all production changes and substantive revisions. Existing request and observability owners carry the change. No new runtime machinery.

## Evidence and decisions

Existing timeout paths enforce the documented request caps. Successful later passes do not prove every failed resource recovered. The missing diagnostic is the timeout's effective budget and last observable request stage. Aggregate investigation justifies bounded user-requested tuning, without claiming a vendor root cause.

## Risks and mitigations

Longer waits increase collection duration. Preserve page/attempt caps and prompt foreground abort. Metadata must survive typed boundaries and final log sanitization without allowing arbitrary strings or excessive cardinality. Use finite enums and bounded numeric fields on existing failure events only.

## Tasks

1. Obtain ReviewGPT-authored patch against current main snapshot.
2. Inspect exact patch, apply accepted changes, and run focused synthetic and boundary validation.
3. Publish scoped PR with changelog decision and privacy-safe evidence; run final ReviewGPT concurrently with CI.
4. Close plan and record unresolved gates honestly. Human review/merge/deployment remains required.

## Verification

Pending authored patch. Run changed Junction client/provider tests, service diagnostic tests, hosted maintenance diagnostic tests, affected typechecks, and content-only changelog generation/render proof. Do not widen testing without a failure or material gap.

## Implementation evidence

ReviewGPT authored the patch. Its original SHA-256 matched the recovered text byte-for-byte after the repository download tool could not expose the attachment. The download/capture limitation is recorded in the task's public-safe Frog entry. No local production implementation was substituted.

Initial candidate: 405 focused device-sync tests, 141 hosted maintenance tests, and 10 changelog rendering tests passed. All 20 full-job scenarios passed across inventory, summary, sleep, sleep-cycle, and timeseries: healthy, between old/new caps, beyond new cap, and foreground cancellation. Loopback HTTP proof distinguishes waiting for headers from an incomplete response body. Failure normalization, typed boundary parsing, and the final crowded log sanitizer preserve valid bounded diagnostics and omit malformed or unrelated-code data. Provider-request, log privacy, and docs-drift guards passed.

Two local validation findings were returned to ReviewGPT: one test assertion loses its index signature after matcher narrowing, and timeout-stage construction increases the request method's complexity debt by one. Required revision and affected revalidation remain pending.

ReviewGPT remediation was applied exactly after checksum verification. Final affected checks pass: 110 Junction client/backfill/transport tests; 141 hosted maintenance tests; device-syncd and assistant-runtime typechecks; complexity guard (Junction client debt 77 to 76; request method complexity 44). Unchanged service/parser proof retains the earlier passing result. Parent review accepts the bounded scope and confirms no runtime-apply diagnostic writer is added. Public changelog presentation uses the content-only rendering route. Product UX: Ready for PR review; deployment benefit remains unmeasured.
