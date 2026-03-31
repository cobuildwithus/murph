# AGENTS router refactor

Status: completed
Created: 2026-03-31
Updated: 2026-03-31

## Goal

Refactor `AGENTS.md` into a compact routing file that behaves more like a table of contents than a policy manual, while preserving repo-local durability for the workflow details agents still need.

## Scope

- shrink `AGENTS.md` by removing durable workflow detail that can live elsewhere
- add or update durable docs so task classification, read paths, and workflow defaults remain explicit
- keep the resulting routing model easy to scan and aligned with the repo's existing verification and completion docs

## Non-goals

- changing repo runtime behavior
- changing commit helper behavior
- weakening guardrails for high-risk or cross-cutting work

## Files

- `AGENTS.md`
- `agent-docs/index.md`
- `agent-docs/operations/agent-workflow-routing.md`
- `agent-docs/operations/verification-and-runtime.md` if cross-links or task classes need alignment
- `agent-docs/operations/completion-workflow.md` if task classes need alignment

## Verification

- scoped verification mode for this docs/process-only lane:
  - read back the touched docs for consistency
  - `git diff --check` on the touched files

## Notes

- Prefer moving durable detail out of `AGENTS.md` rather than merely rewriting it in place.
Completed: 2026-03-31
