# Hosted Foreground Priority Invariants

## Goal

Document the hosted foreground-priority invariants in the canonical invariant docs:
user messages must not be blocked by background device sync, maintenance, or
idle checkpointing work, and an already-running idle checkpoint must yield or
abort when fresh user input arrives.

## Scope

- `docs/contracts/00-invariants.md`
- `agent-docs/references/hosted-runtime-protocol.md`
- `AGENTS.md`
- `agent-docs/operations/agent-workflow-routing.md`

## Non-Goals

- Runtime code changes.
- Reworking device-sync scheduling.
- Creating a second invariant source of truth when an invariant doc already
  exists.

## Constraints

- Keep the wording small and mechanical enough to guide future code reviews.
- Preserve the existing hosted-runtime protocol ownership split.
- Avoid introducing new scheduler concepts or speculative recovery mechanisms.

## Plan

1. Add the broad user-message priority invariant to the baseline invariants doc.
2. Add the hosted-runtime-specific detail to the runtime protocol.
3. Add the baseline invariant doc to the regular repo read-first workflow.
4. Run docs-only verification and privacy/diff hygiene.
5. Commit through the active-plan closeout path.

## Verification

- Passed: readback of `AGENTS.md`, workflow routing, baseline invariants, and
  hosted runtime protocol sections.
- Passed: scoped `git diff --check` for the touched docs.
- Passed: scoped privacy scan for direct local identifiers and secret patterns
  in the touched-doc diff.
Status: completed
Updated: 2026-05-29
Completed: 2026-05-29
