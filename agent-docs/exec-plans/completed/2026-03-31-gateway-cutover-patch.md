# Cloudflare gateway cutover patch landing

Status: completed
Created: 2026-03-31
Updated: 2026-03-31

## Goal

- Land the supplied Cloudflare gateway cutover behavior against the live tree by centralizing gateway event-log apply/poll logic under the existing `murph/gateway-core` boundary and updating the hosted Cloudflare gateway store to use it.

## Success criteria

- `packages/cli` exposes shared gateway event-log helpers without changing the current workspace/package topology.
- Local gateway live-state and `apps/cloudflare` use the shared helper path rather than duplicating event-log diff/apply logic.
- Cloudflare permission responses update the stored snapshot and emit `permission.resolved` events.
- Focused tests cover the shared helper path and the Cloudflare permission-resolution path.
- Required repo verification commands complete, or any failure is shown to be unrelated pre-existing breakage.

## Scope

- In scope:
  - `packages/cli/src/gateway-core.ts`
  - `packages/cli/src/gateway/{snapshot,projection,live-state}.ts`
  - `packages/cli/test/gateway-core.test.ts`
  - `apps/cloudflare/src/gateway-store.ts`
  - `apps/cloudflare/test/gateway-store.test.ts`
  - coordination/plan artifacts needed for repo policy
- Out of scope:
  - creating standalone `@murph/assistant-core` or `@murph/gateway-core` workspace packages
  - unrelated test-harness-speedup work already active in the worktree

## Constraints

- Technical constraints:
  - Preserve the existing `murph/gateway-core` public surface as the canonical boundary for this turn.
  - Do not import sibling workspace sources via relative paths.
- Product/process constraints:
  - Treat the supplied patch as behavioral intent, not blind overwrite authority.
  - Keep the change narrow and behavior-preserving outside the requested gateway cutover.
  - Run the required simplify and final-review subagent audits before handoff.

## Risks and mitigations

1. Risk: The supplied patch assumes standalone workspace packages that do not exist in the live repo.
   Mitigation: Port the intended behavior into the existing `murph/gateway-core` boundary instead of inventing new packages mid-turn.
2. Risk: Shared-helper extraction could drift into broader gateway architecture work.
   Mitigation: Limit the refactor to event-log apply/poll helpers already mirrored in local and hosted code paths.
3. Risk: Concurrent active work in the tree could be overwritten accidentally.
   Mitigation: Keep edits scoped to the gateway-cutover files and avoid touching unrelated active-lane files.

## Tasks

1. Add an active coordination-ledger row and inspect the live Cloudflare gateway/store state against the supplied patch intent.
2. Extract shared gateway event-log helpers into the existing `murph/gateway-core` boundary and switch local live-state to them.
3. Update the Cloudflare hosted gateway store to use the shared helper path and implement permission resolution.
4. Add focused tests for the shared helper path and the Cloudflare permission-resolution/event-emission path.
5. Run required verification plus direct scenario evidence, then complete the mandatory simplify and final-review audit passes.

## Decisions

- Keep the current workspace topology and reuse `murph/gateway-core` instead of creating missing standalone workspace packages.
- Centralize only event-log apply/poll behavior this turn; do not expand the cutover into unrelated gateway abstractions.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
  - Focused checks: `pnpm --dir packages/cli exec vitest run test/gateway-core.test.ts`
  - Focused checks: `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/gateway-store.test.ts`
- Expected outcomes:
  - Required repo commands pass.
  - Focused tests confirm shared event-log behavior and hosted permission resolution/event emission.
Completed: 2026-03-31
