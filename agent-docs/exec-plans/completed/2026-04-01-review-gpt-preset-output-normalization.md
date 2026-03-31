# Review GPT Preset Output Normalization

## Goal

Make every Murph ChatGPT review preset under `scripts/chatgpt-review-presets/` request the same final response shape: one unified `.patch` attachment plus a short plain-text summary of what changed/fixed and any residual concerns.

## Scope

- `scripts/chatgpt-review-presets/*.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`

## Constraints

- Keep each preset's topical audit focus intact.
- Remove divergent return-shape instructions such as structured severity tables, grouped prose-only findings, or `.patched` full-file attachments.
- Do not rename presets or change repo-local wrapper/config behavior.

## Plan

1. Review the current preset prompt files and identify output-shape drift.
2. Rewrite each preset's output section to the shared patch-plus-summary contract.
3. Re-read the changed prompts for consistency and obvious contradictions.
4. Run required verification for the touched scope and commit the exact changed files.

## Verification

- `pnpm typecheck`
- `pnpm test`

Status: completed
Updated: 2026-04-01
Completed: 2026-04-01
