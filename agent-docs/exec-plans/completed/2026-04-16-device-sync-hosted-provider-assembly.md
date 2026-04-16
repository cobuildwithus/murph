## Goal

Hard-cut hosted `apps/web` device-sync provider assembly to reuse the shared `@murphai/device-syncd/config` provider config readers and factory/registry helpers instead of maintaining a second explicit provider config object and registration list.

## Scope

- `packages/device-syncd/src/config.ts`
- `packages/device-syncd/src/index.ts`
- `packages/device-syncd/test/config.test.ts`
- `apps/web/src/lib/device-sync/{env,providers,control-plane-context}.ts`
- focused `apps/web/**` tests plus any durable docs that describe the provider assembly seam

## Constraints

- Keep one authoritative provider registration/config assembly path.
- Avoid package cycles or a new abstraction package.
- Do not expand into webhook-admin or webhook-preflight cleanup owned by adjacent lanes.
- Preserve unrelated in-flight work elsewhere in the tree.

## Verification

- `pnpm typecheck`
- focused truthful diff-aware verification for touched `packages/device-syncd` and `apps/web` surfaces
- readback of updated docs for the shared provider-assembly seam
Status: completed
Updated: 2026-04-17
Completed: 2026-04-17
