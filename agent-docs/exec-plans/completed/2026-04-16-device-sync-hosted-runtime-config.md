## Goal

Hard-cut hosted runner and hosted runtime device-sync config handling to reuse the shared `@murphai/device-syncd/config` provider-config helpers instead of hard-coding provider keys or serializing provider-only fields.

## Scope

- `packages/device-syncd/src/{config,index}.ts`
- `apps/cloudflare/src/runner-env.ts`
- `packages/assistant-runtime/src/hosted-runtime/{environment,parsers}.ts`
- `packages/assistant-runtime/src/hosted-runtime.ts`
- focused tests/docs only if required by the patch or verification

## Constraints

- Keep hosted device-sync config on the shared provider-config seam.
- Do not widen the change back into webhook-admin or webhook-preflight work.
- Keep provider-owned admin secrets and non-serializable fields out of hosted runner envelopes.
- Preserve unrelated in-flight edits in the worktree.

## Verification

- `pnpm typecheck`
- truthful diff-aware coverage for `apps/cloudflare`, `packages/assistant-runtime`, and `packages/device-syncd`
- required completion-workflow audit passes for the touched owners
Status: completed
Updated: 2026-04-17
Completed: 2026-04-17
