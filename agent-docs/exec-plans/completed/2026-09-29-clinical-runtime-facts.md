# Structured facts in runtime clinical imports

Status: completed
Created: 2026-09-29
Updated: 2026-09-30

## Outcome and invariant

Normal clinical runtime imports retain supported source answers and history as
queryable structured facts. Unknown clinical dates and units stay unknown;
source history never activates a condition or records a dose taken. Existing
source attestation, frozen replay and parent correction fences remain authoritative.

## Evidence and owner

The current extraction union cannot express questionnaire answers, scores or
structured historical fields. Its date policy holds every undated fact. The
one-off recovery demonstrated potential coverage, not production behavior.
Extend the existing canonical note contract with a typed clinicalFact field;
reuse core event import, query projections, CLI show/search and enrichment jobs.
No new ledger, queue, assessment write path or storage owner is needed.

## Scope and delivery

A follow-up to the completed structured-enrichment change adds the missing
runtime data representation and extraction behavior. The prior PR remains
stable; this feature has its own scoped diff and review. No production deploy,
merge or automatic historical backfill. Private source records remain local
and cannot become fixtures or review artifacts.

## Product UX

Outcome: imported answers and historical statements can be retrieved as fields.
Entry: ordinary clinical import and its background enrichment.
Affected journeys: dated values, missing units, unknown clinical dates, family
history, prescriptions, retry, source correction and withdrawal.
Proof: synthetic runtime import through canonical readback, CLI retrieval,
negative evidence checks and focused subscription Luna extraction.
Done when: supported facts survive with attribution and status, retries do not
duplicate them, and invalid/withdrawn source facts are not published.

## Implementation and verification

1. Add bounded typed source-fact content to notes and extraction schemas.
2. Preserve unknown dates using explicit null clinicalDate, with a host-owned
   note timestamp. Require literal source evidence and exact coding pairs.
3. Extend ordinary runtime admission where safe; retain parser safety holds.
4. Prove canonical writes/readback, idempotency, corrections and retrieval;
   run affected tests/typechecks, generated contract checks and live Luna proof.
5. Review the diff, document compatibility, commit, open scoped PR and complete
   its required external review and exact-head CI.

## Compatibility and failure

The new optional note field is additive for new readers, but old strict readers
cannot consume new notes/proposals. Upgrade all readers before enabling the
writer and retain that reader version on rollback. Existing notes/checkpoints
stay readable. Disposable extraction caches get a new semantic version.
Keep ambiguous source evidence held; preserve supported siblings.

## Progress

- Implemented typed source notes, null clinical dates, exact coding checks,
  category tags, private search indexing, RTF text and long-text continuation.
- Extended CLI import/show/search proof, runtime replay/withdrawal proof and
  existing source/date tests; focused checks and final affected typechecks pass.
- Three synthetic subscription Luna journeys passed: narrative and JSON field
  values without inferred units, and explicit versus unknown historical dates.
- Private sample proof stayed isolated and is not part of review artifacts.
- New checkpoints are v3 and the extraction cache is v4; query projection v35
  rebuilds the private clinical-field index. Legacy frozen proposals remain readable.
- No new service, queue, generic assessment ledger, or foreground provider call.
- Parent candidate/privacy review, generated contract validation, complexity guard,
  docs drift and changelog rendering passed. Final live date journey passed.
- Implementation is complete. External review and exact-head CI are PR delivery
  gates; their current results belong to the PR evidence rather than this snapshot.
Completed: 2026-09-30
