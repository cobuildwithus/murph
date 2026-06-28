# Product-Critical Flow Preservation

## Goal

Add a durable repo rule that review/audit/safety fixes must not silently break
existing user-critical flows such as onboarding, signup welcome delivery, and
current-inbound replies.

## Scope

- `docs/contracts/00-invariants.md`
- `agent-docs/operations/pr-deep-review-loop.md`
- `AGENTS.md`

## Verification

- Text readback of touched docs.
- `git diff --check`.

Status: completed
Updated: 2026-06-27
Completed: 2026-06-27
