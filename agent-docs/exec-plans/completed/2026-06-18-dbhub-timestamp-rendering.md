# DBHub Timestamp Rendering Guardrail

## Goal

Document the DBHub timestamp rendering trap so production database inspection does not misread UTC-naive hosted timestamps as local-time instants.

## Constraints

- Keep the change docs-only unless a repo-owned DBHub MCP launcher is found.
- Do not expose production row data, secrets, local paths, or direct identifiers.
- Keep `AGENTS.md` route-oriented and put operational detail in `agent-docs`.

## Working Set

- `AGENTS.md`
- `agent-docs/operations/verification-and-runtime.md`
- `agent-docs/index.md`

## Verification Plan

- Probe DBHub with literal-only timestamp expressions to confirm the tool/client rendering behavior.
- Read back touched Markdown files.
- Use text-only docs/process verification; no repo-wide test or typecheck is required for Markdown-only docs changes.
Status: completed
Updated: 2026-06-17
Completed: 2026-06-17
