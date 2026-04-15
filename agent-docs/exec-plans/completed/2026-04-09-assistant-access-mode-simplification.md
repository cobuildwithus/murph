# Assistant Access Mode Simplification

## Goal

Replace misleading prompt capability inference with one explicit Murph command access mode so privileged Codex routes describe direct `vault-cli` access truthfully without pretending they expose bound tool-runtime tools.

## Scope

- `packages/assistant-engine/**`
- `packages/operator-config/**` only if a shared assistant-provider type seam needs a small update
- Focused tests for prompt generation and provider-turn planning

## Constraints

- Keep the change behavior-preserving outside prompt/access wording and capability plumbing.
- Do not broaden hosted authority or change actual provider execution semantics.
- Preserve unrelated in-flight edits.

## Plan

1. Add an explicit Murph command access mode at the provider capability seam.
2. Wire route prompt capability resolution to use that access mode instead of inferring automation access from tool-runtime support.
3. Update prompt wording for vault navigation and automation guidance.
4. Run focused assistant-engine verification.

## Verification

- Targeted assistant-engine Vitest coverage for prompt/runtime seam
- `pnpm typecheck`
Status: completed
Updated: 2026-04-09
Completed: 2026-04-09
