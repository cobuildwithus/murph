# Execution Plan: First-Memory Speedup

Last updated: 2026-04-09

## Goal

Adjust the assistant prompt so straightforward writes and user-facing replies use a lighter default shape without weakening canonical write boundaries.

## Scope

- `packages/assistant-engine/src/assistant/system-prompt.ts`
- `packages/assistant-engine/src/assistant-cli-access.ts`

## Constraints

- Keep the change narrow to prompt guidance only; do not add prompt-specific tests.
- Preserve canonical `vault-cli` write-path expectations and truthfulness about writes.
- Reduce redundant CLI/tutorial guidance, repeated context-check rules, and user-facing formatting bans where they can be collapsed cleanly.
- Leave onboarding guidance intact unless the user explicitly asks to trim it.
- Preserve unrelated in-flight edits in `packages/assistant-engine/**`.

## Plan

1. Simplify the system prompt and CLI guidance text.
2. Run required verification for the touched assistant-engine surface.
3. Run the required final review, address findings, and commit the scoped diff.

## Verification

- Required: `pnpm typecheck`
- Focused: direct prompt readback plus any narrow runtime checks already available

## Notes

- User-reported issue: the assistant prompt still feels too heavy, especially around CLI/tutorial text, repeated context rules, and overly procedural defaults for simple writes.
Status: completed
Updated: 2026-04-09
Completed: 2026-04-09
