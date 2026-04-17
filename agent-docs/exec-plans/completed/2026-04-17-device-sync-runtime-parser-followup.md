## Goal

Make the shared `@murphai/device-syncd/config` seam authoritative for hosted device-sync runtime parsing so unexpected top-level `deviceSync` keys fail closed in assistant-runtime.

## Scope

- `packages/device-syncd/src/config.ts`
- `packages/device-syncd/src/index.ts`
- `packages/device-syncd/test/config.test.ts`
- `packages/assistant-runtime/src/hosted-runtime/parsers.ts`
- focused `packages/assistant-runtime/test/**` parser regression coverage

## Constraints

- Keep the runtime config shape unchanged; this is a parser-hardening follow-up, not a behavior expansion.
- Reuse the shared device-sync config seam instead of introducing another assistant-runtime-specific parser layer.
- Preserve the existing provider-config validation and keep the change scoped to the hosted device-sync runtime seam.

## Verification

- `pnpm typecheck`
- truthful scoped coverage-bearing verification for `packages/device-syncd` and `packages/assistant-runtime`
- focused parser regression proof for the shared runtime config seam
Status: completed
Updated: 2026-04-17
Completed: 2026-04-17
