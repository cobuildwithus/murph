# PR 522 Service Classifier Ownership

## Goal

Remove the duplicate webhook-layer Linq service classifier so the messaging
ingress parser remains the sole owner of service precedence before canonical
iMessage chat classification.

## Constraints

- Keep the exact-chat lookup as the sole owner of group/direct truth for
  resolved iMessage traffic.
- Preserve SMS/RCS handling without the canonical chat dependency.
- Delete duplicate normalization instead of adding another abstraction.
- Keep the change limited to the current PR's webhook planning boundary and a
  focused regression test.

## Working Set

- `apps/web/src/lib/hosted-onboarding/webhook-service.ts`
- `apps/web/test/hosted-onboarding-linq-dispatch.test.ts`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`

## Verification Plan

- Prove a resolved SMS/RCS event with conflicting preferred-service metadata
  bypasses the canonical iMessage chat lookup.
- Run the focused hosted onboarding dispatch suite and web typecheck.
- Run required diff/privacy checks and completion review.
- Commit, push, wait for green exact-head CI, and rerun ReviewGPT.

## Verification Results

- The focused dispatch suite passed: 118 tests.
- Web typecheck and targeted lint passed.
- The serialized diff lane passed, including 4,048 web tests, production build,
  typecheck, lint with zero errors, and development smoke.
- Diff and privacy scans passed.
- Independent validation reproduced the old parser/classifier disagreement and
  confirmed the regression fails the old implementation.
- Completion audit found no evidence-backed medium-or-higher correctness,
  reliability, security/privacy, or simplicity issue.

Status: completed
Updated: 2026-07-10
Completed: 2026-07-10
