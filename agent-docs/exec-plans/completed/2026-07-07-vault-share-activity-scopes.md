# Vault Share Activity Scopes

## Goal

Replace ad hoc per-activity Vault Share minute projection kinds with a selector-scoped activity-minute projection so group challenges can request any currently recognized activity alias without adding a new projection kind per activity.

## Scope

- Add a first-class Vault Share projection scope/key for `activity-minutes-days.v1`.
- Keep existing non-activity projection kinds unchanged.
- Refactor current PR activity-minute support to use selector scopes instead of `running-minutes-days.v0`, `walking-minutes-days.v0`, `swimming-minutes-days.v0`, and `sauna-minutes-days.v0`.
- Do not generalize heart-rate-zone activity selectors in this pass.

## Constraints

- Preserve Vault Share consent and delivery authority boundaries.
- Keep persisted identities deterministic and path-safe.
- Use every activity alias currently recognized by the activity-kind contract.
- Avoid broad all-activity grants for selector-specific challenges.

## Verification

- `pnpm typecheck`
- `pnpm --filter @murphai/hosted-execution test`
- `pnpm --filter @murphai/assistant-engine test -- assistant-skill-assets.test.ts`
- `pnpm --filter @murphai/assistant-runtime test -- vault-share-projection.test.ts hosted-runtime-workspace-entrypoint.test.ts hosted-runtime-group-tool-linq-context.test.ts`
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/vault-share-store.test.ts apps/web/test/vault-share-grant-store.test.ts apps/web/test/vault-share-active-kinds-route.test.ts apps/web/test/vault-share-deliver-route.test.ts apps/web/test/hosted-group-tool.test.ts apps/web/test/hosted-group-store.test.ts apps/web/test/hosted-group-join-accept-route.test.ts apps/web/test/hosted-group-join-offer-reaction.test.ts`
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/runner-platform.test.ts apps/cloudflare/test/runner-outbound.test.ts`
- `pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage packages/cli/test/group-command.test.ts packages/cli/test/incur-smoke.test.ts packages/cli/test/cli-typed-agent-inputs-schema.test.ts`
- `pnpm test:diff -- ...` for the changed Vault Share, group, runtime, CLI, Cloudflare, and web files.
- `pnpm test:smoke`
Status: completed
Updated: 2026-07-07
Completed: 2026-07-07
