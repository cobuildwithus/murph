# ReviewGPT Architecture Simplicity

## Goal

Add a durable rule that ReviewGPT findings are adversarial inputs, not
architecture ownership, and must not cause broad state machines, managers,
queues, or abstractions when a smaller owner-boundary fix is enough.

## Scope

- `AGENTS.md`
- `docs/contracts/00-invariants.md`
- `agent-docs/operations/pr-deep-review-loop.md`

## Verification

- Text readback of touched docs.
- `git diff --check`.

Status: completed
Updated: 2026-06-27
Completed: 2026-06-27
