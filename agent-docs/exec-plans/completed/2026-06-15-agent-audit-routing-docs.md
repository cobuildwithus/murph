# Agent Audit Routing Docs

## Goal

Clarify the audit pass routing so Codex-native agents use spawned subagents, while non-Codex parents such as Claude use `codex exec` only for Codex-billed audit passes.

## Scope

- `agent-docs/operations/agent-workflow-routing.md`
- `agent-docs/operations/completion-workflow.md`
- `agent-docs/prompts/coverage-write.md`

## Validation

- Text-only Markdown fast path: read back touched docs and scan for contradictory `codex exec` audit wording.
- `git diff --check`.
- Privacy scan of the docs diff.

## Status

Active.
Status: completed
Updated: 2026-06-15
Completed: 2026-06-15
