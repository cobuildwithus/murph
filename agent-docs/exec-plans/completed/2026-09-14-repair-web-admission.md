# Settle canceled Web admission checks

## Outcome and invariant

Canceled admission attempts must converge to a failed Vercel check. Only the
existing completed proof job may authorize production promotion.

## Cause and owner

Admission workflow concurrency supersedes waiting runs before any jobs start.
Their dependent finalizer never runs. GitHub owns the terminal run result;
Vercel consumes the corresponding exact-commit status.

## Implementation

- Repair confirmed canceled, unapproved candidates through GitHub failure statuses.
- Add an independent cancellation completion notifier with no checkout or secrets.
- Validate current run identity and attempt; preserve already successful admission.
- Keep current success publisher and admission queue unchanged; reuse the Frog report.

## Failure and deployment

API failures fail the notifier. Stale retry events make no mutation. The notifier
only publishes failure, so rollback cannot authorize an untested deployment.
The new workflow must reach default main before completion events can trigger it.

## Verification

- Controller contract suite: 77 tests passed, including actual notifier shell execution
  for pre-start cancellation, retries, passed admission, invalid identity and API failures.
- Actionlint: both admission workflows pass syntax, expression types, and shell checks.
- Node syntax check, diff whitespace check, complexity guard, and doc gardening passed.
- Metadata-only production readback confirms failure statuses settle imported checks.
- Parent review: no checkout, private credential, success publication, runtime change,
  or replacement queue is introduced. No member-facing changelog is needed.
- Hosted completion-event delivery remains to be observed after default-branch landing;
  exact-head PR CI and external review are recorded on the PR.
Status: completed
Updated: 2026-09-14
Completed: 2026-09-14
