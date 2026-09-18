# Reduce live canary frequency and investigate Linq readiness

Status: completed
Created: 2026-09-18
Updated: 2026-09-18

## Goal and invariants

Reduce paid live proof frequency by at least half while preserving protected-source admission, required hermetic CI, real journey assertions, and owned cleanup. Diagnose Linq canonical-readiness failures without weakening persistence proof or exposing private data.

## Owners and evidence

GitHub workflow triggers own cadence. Existing dispatcher and gate admission must accept scheduled protected-main runs. The Linq observer reads mailbox completion and published canonical replicas; production diagnostics stay transient and redacted. Root cause must be proven before a runtime change.

## Scope and decisions

- Linq every six hours; native platforms every twelve hours.
- Garmin and assistant real-model journeys daily instead of every main push.
- Stripe live matrix daily; preserve hermetic PR/main proof and fail-closed scheduled live result.
- No new scheduler, state, dependency, production mutation, or weakened success assertion.
- Internal verification changes do not require a public changelog.

## Tasks

1. Inspect bounded runtime and mailbox evidence for Linq readiness; reproduce the proven cause.
2. Update cadence, event admission, existing executable guards, and owner docs.
3. Verify the existing main-branch fix deriving the Linq observation deadline from the shared idle policy and retain its deadline and assertions.
4. Run focused tests and typecheck, inspect full diff/privacy, and commit scoped work.

## Failure and deployment

Scheduled proof remains failed if the journey fails or cannot run. Required per-candidate deployment checks remain unchanged. Any runtime correction must state rollout order and remaining live verification needs; no local credentials or private rows enter artifacts.

## Verification

Use native/Linq/wearable dispatcher tests, real-model gate tests, Stripe workflow guard and shell result tests, relevant Linq regressions, repository typecheck, and complexity checks for authored TypeScript. Record results at completion.

## Implementation and evidence

The existing main-branch Linq fix derives the observation limit from the shared ten-minute idle policy plus two minutes of publication time and budgets the workflow accordingly. This task preserves that implementation and verifies its composed observation tests; it does not shorten the product quiet window or waive canonical readback.

Cadence and source/event admission changes are complete. Focused canary/controller tests passed (39), PR lifecycle/result tests passed (27), Stripe/real-model workflow tests passed (72), and Linq runner/outcome tests passed (94). Root typecheck, the final tools typecheck, Stripe workflow guard, docs drift, and complexity guard passed. The unchanged provider-boundary guard remains the only changed-file complexity hotspot (23); scheduling changes add no decision complexity there.

No new repository friction entry was needed. No member-facing behavior changes, so no public changelog entry applies. Review and exact-head CI remain PR gates; live canary execution is separate operational acceptance.
Completed: 2026-09-18
