# PR 654 mixed-source review remediation

Status: completed
Created: 2026-07-14
Updated: 2026-07-14

## Goal

Preserve provider-specific Garmin historical recovery when another Junction
wearable still needs aggregate retries, without restoring metadata/source
coupling or adding lifecycle machinery.

## Success criteria

- A saturated Garmin failure writes only Garmin's reconnect marker while a
  failing Oura obligation keeps aggregate progress retrying.
- A later Garmin success clears that marker without ending Oura's retry cadence.
- Hosted persistence and local hydration compose marker creation and clearing
  through provider-owned source state.
- PR-owned CI regressions are corrected, the exact pushed head receives a
  passing ReviewGPT correction round, and required verification is reported.

## Scope

- In scope: Junction provider recovery projection, hosted source authority,
  hydration arbitration, focused tests, durable ownership docs, and two stale
  PR-owned CI fixtures.
- Out of scope: new provider recovery policies, new persisted state, schema or
  queue changes, unrelated CI failures, and merging the PR.

## Constraints

- Technical constraints: aggregate metadata owns cadence; provider source rows
  own recovery eligibility; importer/client ownership from the first reviewed
  patch remains unchanged.
- Product/process constraints: preserve current ingestion, never mark Oura for
  shared reset, keep the first-reviewed PR baseline immutable, and rerun
  ReviewGPT only after a substantive remediation head is pushed.

## Risks and mitigations

1. Risk: an ordinary source projection clears a valid Garmin marker.
   Mitigation: preserve it during retrying projection and clear it only through
   a coverage-aware provider observation.
2. Risk: aggregate status becomes a second recovery authority again.
   Mitigation: permit either source-marker state while retrying and use
   monotonic source timestamps during hydration.

## Tasks

1. Keep the production-faithful mixed Garmin/Oura failure as a red regression.
2. Implement the provider-owned marker transition with no new state.
3. Simplify hosted/web and assistant hydration coupling and add cross-layer proof.
4. Correct stale CI fixtures, update durable docs, and run required verification.
5. Push a scoped remediation commit and run ReviewGPT round 2 with CI.

## Decisions

- Accepted ReviewGPT round 1's mixed-provider finding after focused reproduction.
- Rejected new maps, queues, or aggregate/provider synchronization state; the
  existing source row and progress metadata remain the two explicit owners.

## Verification

- Passed the full Junction provider file (196 tests before the final two-case
  coverage addition), web authority (37), web wake (81), assistant hydration
  file (71), touched typechecks, documentation guards, privacy scan, and diff
  checks. The final Oura/Apple stale-marker coverage addition passed 2/2.
- Routed verification passed all selected typechecks and every touched or
  downstream package except the known main-equivalent assistant prompt-size
  assertion (`61,018 > 61,000`). Device-sync passed 819/819 in that run.
- Exact pushed-head CI and ReviewGPT round 2 remain the post-commit gates.
Completed: 2026-07-14
