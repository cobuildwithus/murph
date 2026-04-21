Goal (incl. success criteria):
- Debug and fix the hosted Cloudflare local E2E lane so the CI-wired E2E tests can be run cleanly and report a reliable result without tracked residue.

Constraints/Assumptions:
- Preserve unrelated dirty-tree edits and active coordination rows.
- Keep the fix scoped to hosted local E2E harness/test behavior unless evidence proves a production runtime bug.
- Do not expose secrets or local personal identifiers in outputs or files.

Key decisions:
- Start by reproducing a narrow Linq E2E test before widening to the full CI-wired three-job E2E set.
- Treat the Cloudflare Worker startup failure as a real runtime-bundle defect: `@murphai/assistant-runtime/hosted-runtime-contracts` pulled Node-only vault code into the Worker through a value import used only for a TypeScript result type.
- Keep hosted runtime typing on a narrow public `@murphai/assistant-engine/assistant-channel-adapters` entrypoint instead of the broad assistant runtime barrel.
- Keep hosted runtime device-sync parsing on a narrow public `@murphai/device-syncd/runtime-config` entrypoint instead of the daemon config barrel.
- Keep Worker-safe hosted assistant env constants on narrow constants-only entrypoints instead of loading the full operator-config hosted assistant config path.
- Keep device sync metadata sanitization available without importing the broad shared module that pulls daemon runtime config.

State:
- completed

Done:
- Read workflow, verification, Cloudflare skill, reliability, and coordination docs.
- Confirmed the harness restores `apps/web/next-env.d.ts` on normal `stop()`.
- Reproduced the narrow Linq E2E failure as Wrangler/Miniflare Worker startup failure: `Top-level await in module is unsettled`.
- Added hosted local stack fail-fast behavior when a child dev process exits before readiness, with unit coverage.
- Updated the hosted runtime contract model import to use the `ImportSharePackIntoVaultResult` type instead of importing the Node-only `importSharePackIntoVault` runtime value.
- Added a narrow assistant-engine public channel-adapter entrypoint and moved hosted runtime typing imports to it.
- Added a narrow device-syncd runtime-config entrypoint and moved hosted runtime/device-sync config imports to it.
- Added narrow hosted assistant env constants entrypoints and moved Cloudflare/runtime policy imports to them.
- Split device-sync metadata sanitization into a narrow metadata module used by the hosted runtime.
- Confirmed the focused Linq first-contact hosted local E2E passes after the Worker bundle imports were narrowed.
- Added explicit repo-local TypeScript path aliases for the new public subpaths.
- Confirmed all three CI-wired hosted local E2E commands pass.
- Confirmed root `pnpm typecheck` passes.

Now:
- Commit the scoped fix with the active plan closed.

Next:
- Handoff with verification results.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `apps/cloudflare/test/helpers/hosted-local-dev-harness.ts`
- `apps/cloudflare/test/hosted-local-linq-first-contact-e2e.test.ts`
- `apps/cloudflare/vitest.e2e.config.ts`
- `scripts/dev-hosted-local/stack.ts`
- `scripts/dev-hosted-local/stack.test.ts`
- `packages/assistant-runtime/src/hosted-runtime/models.ts`
- `packages/assistant-runtime/src/hosted-runtime/environment.ts`
- `packages/assistant-runtime/src/hosted-runtime/parsers.ts`
- `packages/assistant-runtime/src/hosted-runtime/typing.ts`
- `packages/assistant-runtime/src/hosted-runtime/utils.ts`
- `packages/assistant-runtime/src/hosted-assistant-env.ts`
- `packages/assistant-runtime/src/hosted-assistant-env-constants.ts`
- `packages/assistant-runtime/test/hosted-runtime-typing.test.ts`
- `packages/assistant-runtime/test/hosted-runtime-runner.test.ts`
- `packages/assistant-runtime/test/package-entrypoints.test.ts`
- `packages/assistant-engine/package.json`
- `packages/assistant-engine/src/assistant-channel-adapters.ts`
- `packages/assistant-engine/test/assistant-wrapper-exports.test.ts`
- `apps/cloudflare/src/container-entrypoint.ts`
- `apps/cloudflare/src/hosted-env-policy.ts`
- `apps/cloudflare/src/runner-env.ts`
- `packages/device-syncd/package.json`
- `packages/device-syncd/src/config.ts`
- `packages/device-syncd/src/config/provider-configs.ts`
- `packages/device-syncd/src/hosted-runtime.ts`
- `packages/device-syncd/src/metadata.ts`
- `packages/device-syncd/src/runtime-config.ts`
- `packages/device-syncd/src/shared.ts`
- `packages/device-syncd/test/export-surface.test.ts`
- `packages/operator-config/package.json`
- `packages/operator-config/src/hosted-assistant-config.ts`
- `packages/operator-config/src/hosted-assistant-config-constants.ts`
- `packages/runtime-state/package.json`
- `tsconfig.base.json`
- `pnpm --dir apps/cloudflare test:e2e:linq-delivery:local`
Status: completed
Updated: 2026-04-21
Completed: 2026-04-21
