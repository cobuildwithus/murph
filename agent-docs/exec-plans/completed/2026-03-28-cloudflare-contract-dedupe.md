# Cloudflare Contract Dedupe

Status: completed
Created: 2026-03-28
Updated: 2026-03-28

## Goal

Remove duplicated hosted-email and worker-boundary type contracts in `apps/cloudflare` by reusing one shared hosted-email request type from `@murph/assistant-runtime` and centralizing the common Cloudflare worker env/stub surfaces in one internal module.

## Scope

- `packages/assistant-runtime/src/hosted-email.ts`
- `apps/cloudflare/src/{hosted-email.ts,runner-outbound.ts,index.ts,runner-container.ts}`
- one new shared Cloudflare-internal worker-contracts module if the extraction stays type-only
- focused Cloudflare/runtime tests only if the refactor needs direct regression proof

## Constraints

- Keep this scoped to type and contract cleanup; do not move Cloudflare-only runtime behavior into `packages/assistant-runtime`.
- Preserve the existing hosted-email field names and accepted `targetKind` values exactly.
- Keep runtime request validation local unless a clearly low-risk shared helper emerges without dependency tangles.
- Preserve current worker routing, request handling, and Durable Object behavior.

## Verification

- Required repo checks after landing: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`
- Likely focused proof while iterating: `pnpm --dir apps/cloudflare test`, targeted Cloudflare/runtime Vitest files as needed
- Required completion-workflow audits: `simplify`, `test-coverage-audit`, `task-finish-review`

## Notes

- Active adjacent Cloudflare/runtime lanes already touch nearby files; preserve overlapping edits and keep this change proportional.
Completed: 2026-03-28
