# Stable complete first-input equality across isolated fixtures

Status: completed
Created: 2026-10-18
Updated: 2026-10-18

## Goal and protected invariant

Make the complete first-provider-input equality projection reproducible across
fresh synthetic fixtures without hiding semantic request changes. Raw captures,
byte counts, and raw hashes remain unchanged.

## Cause and scope

Two unchanged runs across individual/group and native/code-only modes proved
that installation identities and generated context containing temporary fixture
roots survived the existing projection. Reusing one scenario for both phases
hid the defect within each measurement. This is test tooling only; no product
runtime, permissions, dependency, or deployment changes.

## Implementation

- Enumerate both installation identity fields alongside existing transport IDs.
- Normalize only exact fixture roots and their verified canonical aliases in
  the three observed generated context fields, longest roots first.
- Preserve path suffixes, surrounding instructions and permissions, unrelated
  paths, metadata, array order, and all other request fields.
- Use independent fixtures per phase and add positive/negative projection proof.

## Verification

- Two unchanged baseline measurement runs passed their old within-fixture
  assertion but differed across runs in all four equality digests.
- Independent-fixture regression failed before the projection correction.
- Seven focused checks passed in each of two independent Vitest runs: semantic
  projection, all four shared-schema modes, and both existing memory-input callers.
- All four baseline and candidate equality digests matched across independent
  runs while raw request hashes remained different.
- Package typecheck passed; complexity guard passed (test-only paths excluded
  from the authored-source metric).
- Existing common-list callers require the built CLI; their first fresh-checkout
  run stopped at the missing build prerequisite. Both passed after the normal
  CLI prepared-runtime build.
- Independent parent candidate review passed. Exact-head ReviewGPT and required
  CI remain merge gates.

## Completion

Internal verification only; no member-visible changelog or deployment required.
Frog autofix issue: #4198. Reuse its existing committed friction report.
Completed: 2026-10-18
