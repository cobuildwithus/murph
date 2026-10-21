# Preserve group draft admission failure causes

## Outcome and invariant

Preserve the existing fatal admission error when it cancels a held group draft wait. Failed admission must continue to prevent reply commitment; no retry, timeout, delivery, validation, or authority policy changes. Existing error reporting should retain the actionable cause instead of a timer AbortError.

## Scope and proof

- Prove the diagnostic loss with synthetic checkpoint rejection during the draft grace window.
- Have ReviewGPT author the smallest correction and regression coverage.
- Inspect all abort paths, focused controller/held-group tests, typecheck, privacy and complexity checks.
- Final pushed-candidate ReviewGPT plus required CI; routine merge and canonical release only after gates.
- Confirm serving revision and observe natural affected outcomes. A passing test does not prove the trigger of any historical production error.

## Ownership

Task-owned isolated checkout. Existing primary edits and independent deployment owners are preserved. No schema, dependency, provider contract, persisted state, or production data mutation is planned.

## Progress

- Source inspection locates draft wait cancellation before fatalAdmissionError is read.
- Baseline: the new synthetic regression failed with ABORT_ERR while all 28 existing controller tests passed.
- ReviewGPT authored a five-line catch at the existing cached draft promise; exact fatal admission error wins, otherwise the original rejection is rethrown.
- Green: 50 controller/grouping tests; one exact hosted checkpoint-rejection safety test (159 unrelated tests excluded); assistant-engine typecheck; complexity debt stays zero with maximum 15.
- Final pushed-candidate review and required CI pending. No deployment or observation has occurred.
- Runtime failure trigger remains unproved; diagnostic correction is independently testable.
