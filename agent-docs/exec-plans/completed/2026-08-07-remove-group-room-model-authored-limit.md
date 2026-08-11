# Remove the group room-model authored-content limit

## Outcome

Allow a group room-model body to grow beyond the former 8 KiB UTF-8
authored-content boundary. Keep the independent 64 KiB raw-file safety ceiling
and ensure the write path cannot create a fixed page that the read path will
immediately classify as unavailable.

## Change

- Remove the 8 KiB room-model constant, dynamic-tool schema cap, and normalized
  body-size validation.
- Validate the complete serialized fixed page against the existing 64 KiB
  defensive file ceiling before the canonical write.
- Continue to render every accepted page completely, with no truncation or
  wrapper-dependent prompt limit.
- Retain raw participant-handle rejection, route authority, compare-and-swap
  digests, the canonical write lock, and untrusted-data prompt framing.
- Update the durable architecture/security contract and existing PR intent.

## Verification

- Focused group room-model and dynamic-tool tests.
- Assistant Engine typecheck.
- Direct proof that a multibyte authored body larger than 8 KiB writes, reads,
  and renders completely.
- Direct proof that a serialized page over the defensive raw-file ceiling is
  rejected before replacing prior state and remains unavailable if encountered
  on disk.
- Existing PR correction review and exact-head CI.

## Progress

- [x] Follow-up requirement and retained invariant identified.
- [x] Implementation and durable docs updated.
- [x] Focused verification passed.
- [x] Existing PR updated and correction review passed.
- [x] Final-head CI passed and plan archived.
Status: completed
Updated: 2026-08-07
Completed: 2026-08-07
