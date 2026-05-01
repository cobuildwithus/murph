# Junction base URL removal

## Goal

Remove the misleading `JUNCTION_BASE_URL` runtime knob so Junction API hosts are chosen only by `JUNCTION_ENV` and `JUNCTION_REGION`.

## Constraints

- Preserve Junction API-key prefix validation by environment and region.
- Tests and mocks must use injected `fetchImpl`, not a fake runtime base URL override.
- Do not change unrelated Junction source identity, serializable-secret, provider-handler, or primitive work.

## State

Done:

- Removed the public/env/provider config fields for `JUNCTION_BASE_URL` and `JUNCTION_ALLOW_CUSTOM_BASE_URL`.
- Kept `resolveJunctionBaseUrl` as the canonical environment/region resolver.
- Added request-routing proof through `fetchImpl` instead of a runtime base URL override.
- Removed the stale deploy/doc optional-var references.

Verification:

- Passed: `pnpm --dir packages/device-syncd exec vitest run test/config.test.ts test/provider-manifests.test.ts test/junction-provider.test.ts --config vitest.config.ts --no-coverage`.
- Passed: `pnpm --dir packages/device-syncd typecheck`.
- Passed: `pnpm test:smoke`.
- Passed: `git diff --check -- <touched paths>`.
- Passed audit: `security-privacy-review`, `coverage-write`, and `task-finish-review` reported no findings.
- Blocked unrelated: root `pnpm typecheck` and scoped `test:diff` fail in assistant-engine fixtures missing `attachmentDescriptors` and `sourceMetadata`.
- Blocked unrelated: `pnpm --dir packages/device-syncd test:coverage` fails in `test/store.test.ts` webhook trace retention lookup returning `null`.

Commit:

- Scoped commit requested after completion. Only remaining base-url-removal hunks that could be staged safely were included; overlapping active dirty work stayed unstaged.

## Working set

- `packages/device-syncd/src/providers/junction-client.ts`
- `packages/device-syncd/src/providers/junction.ts`
- `packages/device-syncd/src/config/provider-env.ts`
- `packages/device-syncd/src/config/provider-manifests.ts`
- `packages/device-syncd/test/config.test.ts`
- `packages/device-syncd/test/junction-provider.test.ts`
- `packages/device-syncd/test/provider-manifests.test.ts`
- `apps/cloudflare/scripts/deploy-automation/worker-optional-vars.ts`
- `apps/cloudflare/DEPLOY.md`
- `agent-docs/exec-plans/active/2026-04-30-junction-greenfield-primitive-v2.md`
- `agent-docs/exec-plans/active/2026-04-30-junction-connection-credential-primitives.md`
Status: completed
Updated: 2026-05-01
Completed: 2026-05-01
