# Collapse Health Commons catalog validation duplication

## Outcome and protected behavior

Simplify the existing catalog validator without changing accepted content,
diagnostic text or ordering, reference resolution, generated artifacts, or APIs.
Missing secondary and safety test-plan references remain optional; declared
measurement-path and onboarding signals retain their existing existence checks.

## Evidence and design

The complexity guard reports `validateHealthCommonsContent` at 79, with file
maximum 79, debt 67, and total complexity 418. Relation type branches repeat
target checks, named measurement fields repeat traversals, and a path map mirrors
the canonical page map. Reuse the page map, existing assertions, and finite
relation/field definitions to delete duplicate validation and map plumbing.
No new state, dependency, validation framework, or product policy is needed.
Failures remain synchronous at the existing build-time boundary; retries,
deployment skew, and runtime authority are unaffected.

## Verification and completion

- [x] Characterize relation direction, optional references, and first-error order.
- [x] Collapse duplicated validation and inspect the full diff for privacy.
- [x] Run focused catalog tests, package typecheck/generation, and complexity guard.
- [x] Review and prepare the scoped candidate for draft PR publication.

The parent session owns candidate review, Ready, exact-head CI, and any required
ReviewGPT round. Changelog is not applicable: build-time maintainability only.

## Results

Removed the mirrored key/path map, repeated relation and measurement checks,
redundant optional-target resolution, and unused source-finding/appraisal result
sets. The existing page map and assertions retain validation ownership.

- Final guard: PASS; validator and file maximum 79 to 70, debt 67 to 58,
  total complexity 418 to 410. Source changed by +103/-162 lines.
- Focused catalog coverage, measurement-plan, and onboarding checks: 30 passing
  tests across the final run and named retry. The authored-content onboarding
  test exceeded 60 seconds under concurrent host load, then passed with the
  invocation-only 180-second timeout; no timeout configuration changed.
- The earlier four-file catalog run passed all 31 tests with the same timeout.
- Package typecheck/generation passed; the direct package compiler passed again
  after deleting unused bookkeeping.
- Full baseline/candidate catalog deep equality passed for 8,043 entities,
  including catalogHash and complete output. Baseline: b2a559812972d70644cffb2bf43923fc9211047d.
- Privacy scan and git diff whitespace check passed. No new Frog entry was needed.
- Parent candidate review approved the source direction. Exact-head CI and any
  routed final external review remain with the parent session after draft publication.

The remaining validator branches represent distinct content checks; splitting
those merely to lower the metric is unjustified. The separate source identity
hotspots at 21 and 27 are unchanged and outside this reference-validation seam.
Status: completed
Updated: 2026-09-10
Completed: 2026-09-10
