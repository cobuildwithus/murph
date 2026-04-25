# Health Commons Generated Artifacts

## Goal

Make `packages/health-commons/generated/**` a true build artifact instead of committed source, while preserving clean checkout behavior for hosted web, package publishing, and runner bundles.

Success criteria:

- Authored Health Commons source data remains under `packages/health-commons/content/**`.
- Generated catalog outputs are gitignored and excluded from normal repo snapshot ZIPs.
- Clean builds/tests that import the generated catalog run generation first.
- `generate:check` validates the generator without requiring committed generated files.
- Package/bundle paths still ship generated catalog artifacts when they need runtime access.

## Scope

- Health Commons generator/check behavior and package metadata.
- Hosted web scripts that import `@murphai/health-commons/generated/catalog.json`.
- Cloudflare runner package-bundle packing that ships `@murphai/health-commons`.
- Repo packaging ignore configuration.
- Direct docs/readme/routing updates for the new artifact policy.

## Constraints

- Do not alter Health Commons content semantics or source pages.
- Preserve unrelated dirty work in the shared checkout.
- Avoid local path, account, or personal identifier leakage in docs, logs, and committed files.
- Keep generated deletion scoped to `packages/health-commons/generated/**` only.

## Plan

1. Confirm generated artifacts derive from `content/**` plus generator/schema code. Done.
2. Update generator check semantics and build/package scripts. Done.
3. Ignore and remove tracked generated catalog artifacts. Done.
4. Exclude generated artifacts from normal audit/source ZIP packaging. Done.
5. Verify from a missing-generated clean state, run required audits, archive this plan, and create a scoped commit if safe. Now.

## Verification

- `generate:check` passes with `packages/health-commons/generated/` absent.
- `pnpm health-commons:generate` recreates the ignored catalog from source content.
- `pnpm --dir packages/health-commons verify` passed from a temporarily missing `packages/health-commons/generated/` directory.
- `pnpm --dir packages/health-commons build` passed.
- `pnpm --dir packages/health-commons test:coverage` passed.
- `pnpm --dir apps/cloudflare typecheck` passed.
- `pnpm exec vitest run apps/cloudflare/test/runner-bundle-workspace-artifacts.test.ts --config apps/cloudflare/vitest.node.workspace.ts --project cloudflare-node-runner --no-coverage` passed.
- `pnpm --dir apps/web typecheck` passed.
- `pnpm --dir apps/web test -- apps/web/test/health-commons-biomarker-detail-page.test.ts` passed; the app Vitest workspace ran all hosted-web tests.
- `pnpm --dir apps/web lint` passed with pre-existing warnings only.
- `bash scripts/package-audit-context.sh --zip --out-dir /tmp/murph-audit-size-check --name generated-ignore-check` passed and produced a 6.5 MB ZIP with no `packages/health-commons/generated/**` entries.
- `pnpm typecheck` is blocked by unrelated `packages/vault-usecases` type errors already present in the shared checkout.
- `pnpm --dir apps/cloudflare test -- test/runner-bundle-workspace-artifacts.test.ts` is blocked by an unrelated `apps/cloudflare/test/container-image-contract.test.ts` expectation about `runner:docker:base`.
- Required coverage-write audit added focused nondeterminism coverage.
- Required security/privacy audit found no blockers and requested clean-test and runner-pack preflight hardening; those fixes were applied.
Status: completed
Updated: 2026-04-25
Completed: 2026-04-25
