# Codex Image Input

## Goal

Enable the local Codex CLI assistant adapter to pass native image attachments through to `codex exec` while keeping unsupported rich content, including PDFs/files, on the existing text-only fallback path.

## Success Criteria

- Codex-backed assistant turns retain image user-message parts instead of dropping all rich content.
- The Codex CLI runtime writes supported image parts to temp files and passes them via `codex exec --image`.
- Unsupported file/PDF parts still degrade to prompt-only behavior rather than being forwarded incorrectly.
- Focused tests cover routing, Codex arg construction, and provider forwarding behavior.

## Scope

- `packages/assistant-engine/**`
- `packages/cli/test/**`

## Constraints

- Do not add OCR, PDF parsing, or other new attachment infrastructure.
- Do not claim generic Codex rich-content support beyond the image path proven by the local CLI surface.
- Preserve existing non-Codex provider behavior.
- Preserve unrelated in-flight assistant-engine edits.

## Verification

- `pnpm typecheck`
- Truthful scoped coverage via `pnpm test:diff <path ...>` if it covers the touched owners; otherwise use touched package coverage commands
- Required `coverage-write` audit on `gpt-5.4-mini`
- Required `task-finish-review` audit
Status: completed
Updated: 2026-04-15
Completed: 2026-04-15
Completed: 2026-04-15
Completed: 2026-04-15
