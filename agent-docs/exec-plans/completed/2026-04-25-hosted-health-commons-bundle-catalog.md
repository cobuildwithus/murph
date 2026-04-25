# Harden hosted Health Commons bundle catalog proof

Status: completed
Created: 2026-04-25
Updated: 2026-04-25

## Goal

- Diagnose and harden the hosted Cloudflare runner bundle path so deployed assistants cannot ship with a stale or missing Health Commons generated catalog that hides known protocols such as Finnish Dry Sauna.

## Success criteria

- The runner bundle packaging/deploy validation fails before deploy when `@murphai/health-commons` is missing runtime files or ships a catalog that does not include the Finnish Dry Sauna protocol.
- Focused tests cover the packaged/deploy artifact path, not only source-workspace lookup.
- Direct hosted-like CLI/runtime probes show the bundled `vault-cli` and bound Health Commons tools can find the sauna protocol.
- The fix stays deploy-artifact/local-runner scoped and does not change Health Commons content or assistant medical advice behavior.

## Scope

- In scope:
- `apps/cloudflare/scripts/**` runner bundle and deploy-artifact validation helpers
- directly coupled `apps/cloudflare/test/**` tests
- focused CLI/runtime probes against `apps/cloudflare/.deploy/runner-bundle`
- `agent-docs/exec-plans/active/{2026-04-25-hosted-health-commons-bundle-catalog.md,COORDINATION_LEDGER.md}`
- Out of scope:
- Health Commons authored content changes
- assistant prompt/product copy changes unless a direct bug is found in the hosted tool surface
- hosted web billing/onboarding changes
- live Cloudflare deploy or live production bucket mutation

## Constraints

- Preserve unrelated dirty-tree edits and active hosted/web/research rows.
- Do not commit regenerated Health Commons catalog artifacts unless this task intentionally changes their source or generator.
- Treat hosted runtime and health data surfaces as high sensitivity; do not print secrets, raw credentials, or user identifiers.
- Prefer mechanical deploy-time failure over relying on model behavior to notice missing catalog state.

## Tasks

1. Completed: load repo routing, Cloudflare, security, reliability, and verification guidance.
2. Completed: inspect current runner bundle, prebuild, generated-catalog, and deploy validation code paths.
3. Completed: reproduce source and bundled Health Commons lookup behavior with CLI/runtime probes.
4. Completed: add deploy/bundle validation and regression coverage for missing, stale, invalid, and symlink-escaped Health Commons runtime/catalog artifacts.
5. Completed: run focused Cloudflare tests, typecheck, direct bundled probes, scoped diff verification, hosted-local e2e, and required audit passes.
6. Pending: close the plan and create a scoped commit if exact staging is safe.

## Decisions

- Use Finnish Dry Sauna as a sentinel because it is a known current protocol and it exercises the exact hosted symptom the user reported.
- Keep the check in the deploy/bundle artifact path so a stale generated catalog is caught even when local source lookups pass.
- Keep executable bundled-runtime validation after source and bundle fingerprint checks pass. Inert package/file checks run earlier; dynamic import only uses resolved, non-symlinked files contained inside the runner bundle.
- Treat `commons search --query ...` as invalid CLI syntax; use positional `commons search "<query>"` or `commons protocol list --query "<query>"`.

## Verification

- Passed: `pnpm --dir apps/cloudflare test:node -- test/deploy-artifacts.test.ts test/runner-bundle-workspace-artifacts.test.ts` (61 files / 617 tests).
- Passed: `pnpm --dir apps/cloudflare typecheck`.
- Passed: `bash scripts/workspace-verify.sh test:diff apps/cloudflare/scripts/deploy-artifacts.ts apps/cloudflare/test/deploy-artifacts.test.ts apps/cloudflare/test/runner-bundle-workspace-artifacts.test.ts`.
- Passed: `pnpm --dir packages/health-commons generate:check`.
- Passed: focused assistant-engine Health Commons prompt/tool tests and CLI commons command tests.
- Passed: `pnpm --dir apps/cloudflare runner:bundle` plus hosted-like bundled `vault-cli commons protocol list --query "sauna / heat exposure" --format json --limit 5` and `vault-cli commons search "sauna / heat exposure protocol" --format json --limit 5`; both found Finnish Dry Sauna.
- Passed: invalid bundled CLI probe `vault-cli commons search --query "sauna / heat exposure protocol" --format json --limit 5` returned `Unknown flag: --query`.
- Passed: `pnpm --dir apps/cloudflare test:e2e:linq-delivery:local`.
- Passed: `git diff --check` on touched files.
- Completed: `coverage-write`, `security-privacy-review`, and `task-finish-review` audit passes. Follow-up security findings around dynamic import ordering and symlink escapes were fixed and re-reviewed clean.
- Note: one scoped diff run hit an unrelated-looking timeout in `apps/cloudflare/test/container-entrypoint.test.ts`; isolated rerun of that test passed, and the final scoped diff run passed.

## Outcome

- Local source and rebuilt production-style runner bundle can both find Finnish Dry Sauna. The deployed symptom is most consistent with a stale or different deployed runner bundle/catalog, not the current source Health Commons corpus or prompt/tool surface.
- Deploy validation now fails if bundled Health Commons runtime/catalog files are missing, schema-invalid, stale for the Finnish Dry Sauna sentinel, or escape the runner bundle via package/file symlinks. Runtime schema validation happens only after the bundle fingerprint passes.
Completed: 2026-04-25
