# Invalid initial review recovery

## Outcome and invariant

Resolve #2856: an invalid first attempt followed by an authorized candidate
change can receive its first valid full review. Once a substantive review
validates, preserve the immutable first-reviewed baseline and all round limits.
An accepted prompt awaiting capture must be recovered before it is classified
invalid. This procedure grants no edit authority and discards no findings.

## Approach and proof

Clarify the existing docs: preserve invalid-attempt history, replace only the
single provisional baseline line, and package round one at the new exact head.
The existing packager already supports this transition; extend its executable
fixture to prove full-snapshot metadata and empty remediation deltas while
retaining prior invalid-attempt evidence. Existing later-round reset rejection
remains required. Run the focused packaging test and CLI typecheck, review the
whole diff, and let fresh exact-head CI gate the updated PR.

## Completed evidence

- Focused executable round-packaging test passed, including preserved invalid-attempt history, full new-head snapshot, empty deltas, and existing later-round baseline rejection.
- CLI typecheck, complexity guard, and docs drift passed.
- Parent review confirmed this changes review instructions and proof only; no packager, runtime, or deployment behavior changed.
- The owned PR returns to Ready only after this committed candidate and updated evidence are pushed; required checks must pass on that head.
Status: completed
Updated: 2026-09-11
Completed: 2026-09-11
