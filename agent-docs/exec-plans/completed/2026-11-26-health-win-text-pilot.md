# Health win text pilot

Status: completed

## Outcome

A member explicitly enrolled in the pilot can receive one generic iMessage on
an established direct thread for a newly detected health achievement. The link
lets a compatible companion select the card after its usual authenticated read.
The first complete, nonempty observation establishes a silent baseline.

## Implementation

- Derive achievement identity and freshness in the detectors. Seal the private
  descriptor with each candidate and expose a member-bound reference in the
  authenticated composer response.
- Serialize presentation, local-day claims and observation of new achievements
  on the member's nudge row. Keep the composer as the sole publisher of sets.
- Apply eligibility and timing checks to exact-text queueing and signed delivery.
  Use the existing mailbox and delivery receipts for expiry and unanswered texts.
- Provide a generic link fallback and universal link association. Keep enrollment
  empty by default and retain the egress rejection on rollback.

## Verification

The 18 changed Web suites passed 505 tests with PostgreSQL enabled on a fresh
loopback database. The delivery test followed a silent baseline through
concurrent sweeps, an encrypted wake, a matching composer reference and
rejection after presentation. The cache suite posted a held selection after a
background evaluation. The detector suite covered freshness, deferred streaks
and identity across display variants.

The hosted-execution suites passed 43 tests. The runtime system-mailbox suite
passed 90 tests, including delivery with exhausted usage, rich-link fallback
and zero model calls. Chromium exercised the public route at phone and desktop
widths and verified the generic preview, app link and malformed-reference 404.

The local checks used synthetic data and provider stubs. A compatible runner
and companion build are prerequisites for the first on-device pilot delivery.
Updated: 2026-11-26
Completed: 2026-11-26
