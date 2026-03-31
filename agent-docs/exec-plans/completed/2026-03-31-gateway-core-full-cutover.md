# Gateway Core Full Cutover

Status: completed
Created: 2026-03-31
Updated: 2026-03-31

## Goal

- Finish the gateway compatibility-shim migration by making `@murph/gateway-core` the real owner of both the transport-neutral root surface and the `./local` implementation surface.

## Outcome

- Moved the local gateway implementation into `packages/gateway-core/src/{local-service,projection,send,store}.ts` and made `packages/gateway-core/src/local.ts` own the exported local surface directly.
- Added the gateway-native `gatewayBindingDeliveryFromRoute` helper and widened `@murph/assistant-core` only enough to export `deliverAssistantOutboxMessage`.
- Removed the direct `murph` dependency from `packages/gateway-core`, turned `packages/cli/src/{gateway-core,gateway-core-local}.ts` into thin compatibility re-exports, and deleted the redundant CLI-owned gateway implementation under `packages/cli/src/gateway/**`.
- Switched the daemon client to import gateway contracts from `@murph/gateway-core` and updated package refs, tests, and architecture/docs for the hard-cut owner-package shape plus conservative signature-based rebuild wording.
- Stabilized the CLI runtime coverage lane by making `packages/cli/test/runtime.test.ts` run serially instead of using the local concurrent helper for its heavy CLI fixture setup.

## Verification

- Passed:
  - `pnpm --dir packages/gateway-core exec tsc -p tsconfig.json --noEmit --pretty false`
  - `pnpm --dir packages/cli exec vitest run test/gateway-core.test.ts test/gateway-local-service.test.ts test/gateway-daemon-client.test.ts --no-coverage --maxWorkers 1`
  - `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-events.test.ts --no-coverage --maxWorkers 1`
  - `pnpm --dir packages/cli exec tsx ./scripts/verify-package-shape.ts`
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm --dir packages/cli exec vitest run test/runtime.test.ts --no-coverage --maxWorkers 1`
- Remaining repo baseline issue:
  - `pnpm test:coverage` still fails for unrelated existing coverage-lane instability: long-running CLI suites under repo-wide coverage plus an `ENOENT` write to `coverage/.tmp/coverage-74.json`.
