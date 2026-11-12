# Sparse calendar day diagnostics

## Outcome and invariant

Distinguish calendar provenance failures with three finite categories on the
existing failed-attempt event. Preserve import decisions, source/day authority,
canonical writes, foreground priority, and retained retry scheduling.

## Evidence and implementation

Synthetic normalization proves that an explicit calendar conflict, a source
offset crossing, and an out-of-window absolute start previously emitted identical
diagnostics. The existing aggregate-day resolver now returns its selected basis
alongside the same day. The validator emits that basis and UTC/resolved-day
relations only for day mismatches. Service and hosted boundaries both apply the
existing closed-vocabulary sanitizer. No raw dates, offsets, timezone strings,
health values, extra event, state, network call, retry, or dependency are added.

The user explicitly authorized direct implementation and opted out of ReviewGPT.
Local candidate review preserves the existing resolver precedence, including
source-offset precedence over explicit dates and explicit dates for offset
strings. It does not establish that rejected production rows should be accepted.
The diagnostic is the bounded prerequisite to proving a behavior correction.

## Verification

- [x] Synthetic ambiguous causes reproduced and now distinguishable.
- [x] Importer suite and diagnostic proof: 274 tests passed.
- [x] Service propagation and categorical privacy checks: five tests passed.
- [x] Hosted existing-event projection: 49 cases passed, including unknown and
  private-shaped values omitted, legacy field absence, and unrelated errors.
- [x] Importer, device-syncd and assistant-runtime typechecks passed.
- [x] Parent review: no new authority or awaited operation; valid normalization
  follows the same day precedence and all existing importer proofs pass.
- [x] Complexity check passes with no increase in existing hotspot debt.
- [ ] Required exact-head CI, merge and protected deployment.

## Release and observation handoff

This internal diagnostic has no member-visible changelog item. Deploy through
protected Murph Cloud with the normal runner smoke and protocol gates; no new
Web reader or migration is required. Optional scalar fields support mixed
versions; missing fields mean unknown. Verify producer convergence, then compare
natural day-mismatch categories and ordinary imports immediately and every
30 minutes for four hours. The automation memory owns that same-run release
continuation and observation receipts; no new sweep is admitted.

Existing event frequency and retention are unchanged. Retain these fields only
if 24–72 hours of natural failures distinguish the candidate causes; otherwise
remove them through a separately reviewed change. Any behavioral correction
requires additional causal proof. Never replay or change production state merely
to generate traffic.
Status: completed
Updated: 2026-11-11
Completed: 2026-11-11
