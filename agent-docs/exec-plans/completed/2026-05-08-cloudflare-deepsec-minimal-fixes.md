# Cloudflare Deepsec Minimal Fixes

Status: completed
Created: 2026-05-08
Updated: 2026-05-08

## Goal

- Resolve the selected `.deepsec` Cloudflare deploy/logging findings with minimal architecture: reduce exposed authority and sensitive diagnostics at the source, and avoid executing mutable prepared bundle code during deploy validation.

## Success criteria

- Package-manager helper subprocesses no longer inherit the full parent deploy environment by default.
- Runner bundle install reuses the repo's existing pnpm dependency policy instead of hand-copying one setting.
- Hosted bundle validation errors and hosted email send failures do not carry raw storage object keys or raw email addresses in error/log details.
- Deploy artifact validation checks the Health Commons catalog without importing JavaScript from the mutable prepared runner bundle.
- Focused tests cover the changed boundaries.

## Scope

- In scope: `apps/cloudflare` deploy artifact validation, runner-bundle process/install helpers, hosted bundle/email diagnostics, hosted observability allowlists, focused tests.
- Out of scope: new durable nonce replay infrastructure, broad deploy provenance/signing machinery, Docker image digest/checksum pinning beyond review notes.

## Constraints

- Technical constraints: keep env injection explicit and allowlisted; preserve deploy commands that need normal Node/pnpm execution; do not add a new dependency-policy subsystem.
- Product/process constraints: preserve unrelated active work and dirty files; do not expose contact identifiers, storage keys, secrets, or local paths in logs/docs/tests.

## Risks and mitigations

1. Risk: over-scrubbing environment variables breaks pnpm/node execution in local or CI deploy artifact assembly.
   Mitigation: keep a conservative allowlist for platform/toolchain variables, isolate package-manager home/config/cache/Corepack/npm/pnpm state under a temp home, merge explicit command env last, and cover required keys in tests.
2. Risk: deploy validation loses coverage by not importing the bundled Health Commons runtime.
   Mitigation: validate the generated catalog JSON with the canonical Health Commons contract schema and the sentinel protocol expected by deploy smoke, keeping runtime import coverage in package tests.

## Tasks

1. Harden runner-bundle subprocess environment and dependency-policy materialization.
2. Remove raw bundle object keys and email addresses from diagnostic/error surfaces.
3. Replace prepared-bundle runtime import validation with direct catalog JSON validation.
4. Add focused tests and run the scoped Cloudflare/package checks.

## Decisions

- Do not add a Cloudflare nonce replay store in this pass; the current web-callback signature route is deploy-smoke-only, and durable replay state would add complexity without fixing a current user-scoped route.

## Verification

- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/runner-bundle-process.test.ts apps/cloudflare/test/runner-bundle-dependency-install.test.ts apps/cloudflare/test/deploy-artifacts.test.ts apps/cloudflare/test/hosted-email.test.ts apps/cloudflare/test/runner-bundle-helpers.test.ts packages/hosted-execution/test/hosted-execution-observability-side-effects.test.ts --no-coverage` passed; the package test is covered by the package-specific run below.
- `pnpm --dir packages/hosted-execution exec vitest run --config vitest.config.ts test/hosted-execution-observability-side-effects.test.ts --no-coverage` passed.
- `pnpm --dir apps/cloudflare typecheck` passed.
- `pnpm --dir packages/hosted-execution typecheck` passed.
- `pnpm --dir packages/hosted-execution test` passed.
- `pnpm --dir packages/contracts build` passed and was needed before the full Cloudflare node suite because runner-bundle artifact tests build Health Commons against the built contracts package.
- `pnpm --dir apps/cloudflare test:node` passed after the contracts build.
- `bash scripts/workspace-verify.sh test:diff ...` is blocked by an unrelated `packages/assistant-engine` Telegram expectation mismatch: expected `ASSISTANT_TELEGRAM_DELIVERY_FAILED`, received `ASSISTANT_TELEGRAM_DELIVERY_AMBIGUOUS`.
- After security/final-review follow-ups, `pnpm deps:guard` passed.
- After security/final-review follow-ups, `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/runner-bundle-process.test.ts apps/cloudflare/test/runner-bundle-dependency-install.test.ts apps/cloudflare/test/deploy-artifacts.test.ts apps/cloudflare/test/hosted-email.test.ts apps/cloudflare/test/runner-bundle-helpers.test.ts apps/cloudflare/test/runner-bundle-workspace-artifacts.test.ts --no-coverage` passed.
- After security/final-review follow-ups, `pnpm --dir packages/contracts build` passed.
- After security/final-review follow-ups, `pnpm --dir packages/hosted-execution typecheck` passed.
- After security/final-review follow-ups, `pnpm --dir packages/hosted-execution test` passed.
- After final-review schema validation follow-up, `pnpm --dir apps/cloudflare typecheck` is blocked by unrelated dirty `packages/assistant-engine/src/assistant/outbox.ts`: `Property 'signal' does not exist on type ...`.
- A late full `pnpm --dir apps/cloudflare test:node` rerun hit a single unrelated 60s timeout in `apps/cloudflare/test/container-entrypoint.test.ts`; `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/container-entrypoint.test.ts --no-coverage` passed immediately afterward.

## Audit

- Required security/privacy review found ambient package-manager home/config/proxy state; fixed with an isolated temp home, empty npm userconfig, and explicit env opt-in.
- Security follow-up found ambient Corepack/cache/store inheritance; fixed by isolating Corepack/npm/pnpm cache and store paths under the temp home.
- Security follow-up found path-bearing runner-bundle failure messages; fixed with path-neutral errors.
- Coverage-write review found no test gaps and made no edits.
- Final completion review found shallow Health Commons catalog validation; fixed by using `healthCommonsCatalogSchema` from `@murphai/contracts` plus a schema-invalid catalog regression test.
- Final completion review rerun reported no findings.
Completed: 2026-05-08
