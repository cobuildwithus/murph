# 2026-04-02 Repo Verification Green Pass

## Goal

- Get the current tree through the repo-required verification lane and commit the remaining dirty files without widening into unrelated feature work.

## Scope

- `agent-docs/exec-plans/active/{2026-04-02-repo-verification-green-pass.md,COORDINATION_LEDGER.md}`
- `scripts/ensure-next-route-type-stubs.ts`
- `scripts/{build-test-runtime-prepared.mjs,release-manifest.json}`
- `package.json`
- `tsconfig.test-runtime.json`
- `packages/local-web/test/{overview.test.ts,page.test.ts,next-route-type-stubs.test.ts}`
- `packages/cli/{README.md,test/{cli-test-helpers.ts,release-script-coverage-audit.test.ts}}`
- `apps/web/test/{hosted-device-sync-internal-routes.test.ts,hosted-contact-privacy.test.ts}`
- `apps/web/scripts/dev-smoke.ts`
- generated verification artifacts that must be committed if the repo scripts rewrite them

## Findings

- `packages/local-web` had stale overview expectations (`records`) and a route-type helper that only emitted `routes.d.ts` even though current validators import `./routes.js`.
- `apps/web/test/hosted-device-sync-internal-routes.test.ts` and `apps/web/test/hosted-contact-privacy.test.ts` still sent the pre-nested device-sync apply shape even though the parser now requires nested `connection` / `localState` fields.
- The earlier `@murphai/messaging-ingress` extraction had not been wired into the release manifest, prepared-runtime build graph, or release coverage assertions, so repo `test` / `test:coverage` failed in the CLI release audit.
- `apps/web` dev smoke could also fail after aborted runs because Next left a stale `.next-smoke/dev/lock` file behind; the smoke launcher now drops only stale locks before booting.

## Constraints

- Keep the fix lane narrow and verification-owned.
- Do not revert or overwrite unrelated worktree edits.
- Prefer fixing stale tests/helpers over changing established runtime behavior unless the runtime is clearly wrong.

## Plan

1. Patch the Next route-type stub helper so clean typecheck flows materialize the JS sibling current validators import.
2. Update stale local-web and hosted device-sync tests to match the current contracts.
3. Clear the blocking hosted-web smoke process, then re-run focused proof and the full repo-required checks.
4. Run the required final audit review and commit the narrow verification-fix diff plus the generated doc-inventory update.

## Verification Target

- Focused proof:
  - `pnpm exec vitest run --config packages/local-web/vitest.config.ts --project local-web --no-coverage packages/local-web/test/overview.test.ts packages/local-web/test/next-route-type-stubs.test.ts`
  - `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-device-sync-internal-routes.test.ts apps/web/test/hosted-contact-privacy.test.ts`
- Required checks:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
  - `pnpm --dir apps/web lint`

## Status

- Completed
- Updated: 2026-04-02
Status: completed
Updated: 2026-04-02
Completed: 2026-04-02
