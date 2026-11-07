# Attribute retained assistant wake deadlines

Status: completed
Created: 2026-09-18
Updated: 2026-09-18

## Outcome and protected invariant

Distinguish an assistant pass selecting queued work from checkpoint ordering
retaining an older wake. Keep all scheduling, delivery, and authority decisions
unchanged until a synthetic reproduction establishes the defect.

## Evidence and owner

The prior synthetic entrypoint probe correctly replaced a stale wake with a
future deadline. The existing assistant pass log exposes wake presence but not
the offsets or candidates that explain the selection. Extend that existing
bounded log with relative numeric offsets and progress-cause booleans. Reuse
already computed candidates; add no filesystem reads, network calls, state,
retries, or additional events. Do not log exact timestamps or payloads.

## Proof and completion

Prove the diagnostic gap with synthetic phase fixtures, then run focused
assistant diagnostics and relevant typecheck. Review privacy and bounded log
shape, update the diagnostic owner, check complexity and documentation, and
complete required review and exact-head CI. Deploy through the protected
workflow and inspect the new metadata before proposing a scheduler change.

## Implementation evidence

Two synthetic cases failed on the old logger and pass with the added fields:
an overdue system candidate winning over future automation, and absent system
work leaving the future automation deadline selected. Assertions also exclude
the original timestamp strings from the emitted diagnostic. All six phase
diagnostic tests and the assistant-runtime typecheck pass. Complexity debt is
unchanged at 287; no additional hotspot was introduced. Documentation drift,
raw-payload logging guard, and whitespace checks pass.
An additional 227 existing scheduling, foreground, delivery, and phase-log tests
pass, covering the logger's other callers and unchanged phase results.

This candidate adds only fields to the existing buffered event. Runtime phase
results, checkpoint state, provider behavior, and log event counts are unchanged.
No public changelog entry is appropriate for internal diagnostic metadata.
The earlier bounded investigation is retained as synthetic negative evidence;
neither record claims that a scheduling defect has been repaired.
Completed: 2026-09-18
