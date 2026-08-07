# Group room-model prompt-limit compatibility

## Outcome

Keep an accepted group room-model page available on ordinary group turns even
when static advisory wrapper text grows. Bound authored room-model content by
the existing 8 KiB UTF-8 body limit and keep the defensive 64 KiB file-read
ceiling, but do not reject a valid page because the rendered prompt wrapper
pushes the combined prompt past a separate byte threshold.

## Root cause

The reader and writer validated the byte size of the complete rendered advisory
prompt. A later increase in static wrapper guidance made an already-persisted,
otherwise valid page exceed that wrapper-dependent ceiling. Reads then failed
open by omitting the page, while mutations failed closed because the same page
was classified as unavailable.

## Implementation

- Remove the rendered-prompt byte constant and validation path.
- Validate normalized authored content directly against the existing 8 KiB
  UTF-8 room-page boundary at both read and write boundaries.
- Keep complete, non-truncated prompt rendering and the existing raw participant
  handle rejection.
- Update tool guidance and durable architecture/security contracts to describe
  the body-owned boundary.
- Add a regression proving a valid persisted page remains readable when its
  complete rendered prompt exceeds the retired 6 KiB threshold, plus proof that
  an over-8-KiB multibyte body is still rejected without replacing prior state.

## Verification

- Focused Assistant Engine room-model tests.
- Assistant Engine typecheck.
- Direct test proof that the compatibility fixture renders beyond the retired
  threshold and is still injected completely.
- Exact pushed-head CI plus the required preliminary ReviewGPT product,
  prompt, and coverage lenses.

## Progress

- [x] Production symptom and code-path root cause proved.
- [x] Implementation and durable docs updated.
- [x] Focused verification passed.
- [x] Review candidate committed and pushed.
- [x] Required review and CI gates passed.
- [x] Plan archived by the final task commit.
Status: completed
Updated: 2026-08-07
Completed: 2026-08-07
