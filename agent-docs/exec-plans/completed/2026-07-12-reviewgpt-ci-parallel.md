# Parallel ReviewGPT and CI Gate

## Goal

Prevent PR lanes from waiting for CI before starting ReviewGPT. Success means the startup rules and completion sequence both require an exact-head ReviewGPT round to start as soon as that head is ready, while CI runs independently.

## Constraints

- Keep `AGENTS.md` compact and route detailed sequencing to the completion workflow.
- Preserve the rule that ReviewGPT only reviews a pushed, clean, exact PR head.
- Do not waste a round when a PR-specific change is already known to be required.
- Preserve the existing rerun exception for base-only updates after a zero-finding round.

## Evidence

- The routing and completion docs already describe ReviewGPT as parallel with CI.
- Active PR lanes still parked on pending CI, so the rule needs a direct “never wait” statement in the startup instructions and at the start of the completion sequence.

## Plan

1. Add the compact concurrency invariant to `AGENTS.md`.
2. Add the exact launch condition and no-wait rule to the completion workflow.
3. Read back the changed text, inspect the diff, and run Markdown-safe verification.
4. Close the plan with a scoped docs-only commit.

## Verification

- Read back both changed sections.
- Search the two docs for the concurrent-gate language.
- Run `git diff --check` on the scoped diff.

## State

Complete. Both durable instructions now state the concurrent-gate rule, and the scoped Markdown diff passed readback and whitespace verification.
Status: completed
Updated: 2026-07-12
Completed: 2026-07-12
