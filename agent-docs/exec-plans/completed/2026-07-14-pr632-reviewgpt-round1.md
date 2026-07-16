# PR 632 ReviewGPT round 1

## Goal

Preserve member-authored event annotations when a higher-confidence WHOOP
spot-RMSSD capture supersedes the same daily canonical event.

## Constraints

- Keep the correction local to the existing higher-confidence reconciliation
  policy.
- Preserve incoming provider ownership of the measurement, confidence,
  provenance, and external reference.
- Preserve the current live event's member-owned note, tags, and links.
- Add no migration or compatibility machinery for the unreleased legacy
  admission-key format.

## Approach

1. Overlay note, tags, and links from the live event when accepting a
   higher-confidence provider revision.
2. Exercise the normal event edit path before a limited-to-good upgrade and
   prove annotations remain on the live revision.
3. Run focused verification and completion audits, commit, push, and rerun
   ReviewGPT against the new exact head.

## State

Complete.

ReviewGPT Round 1 disposition:

- Accepted annotation-loss finding. Higher-confidence WHOOP revisions now
  preserve the live event's note, tags, and links.
- Rejected the requested legacy admission-key migration/repair. The iOS
  producer remains unreleased and DEBUG-gated, the signed-device release gate
  is incomplete, and no production legacy records are established; adding a
  migration would invent state and complexity.
- A follow-up security review narrowed annotation preservation to the
  `prefer-higher-confidence` policy so ordinary provider-owned note
  corrections remain incoming-owned.

Verification completed:

- Core and importer typechecks.
- Focused core device-import/validation suites (145 tests).
- Focused Junction importer suite (138 tests).
- Core coverage suite (672 tests; 90.10% statements, 81.80% branches).
- Importer coverage suite (360 tests; 90.79% statements, 82.95% branches).
- Final coverage-write and security/privacy audits with no unresolved
  findings.
Status: completed
Updated: 2026-07-14
Completed: 2026-07-14
