# Secret Boundary Medium Fixes

## Goal

Fix two DeepSec Medium findings with small, durable primitives:

- Hosted workspace snapshots must exclude every `.env*` file name, not only `.env` and `.env.*`.
- Web log redaction must remove complete Authorization, Proxy-Authorization, Cookie, and Set-Cookie header values.

Success means focused tests prove the sensitive cases, verification passes, required security/coverage/final audits are complete, and the change is committed through `scripts/finish-task`.

## Constraints

- Preserve unrelated worktree changes.
- Do not print or fixture real secret values.
- Keep the fix primitive-level and avoid route-by-route or call-site-specific complexity.
- `packages/runtime-state/src/hosted-bundles.ts` overlaps an active diagnostics plan; this task changes only the environment-file exclusion predicate and tests.

## Plan

1. Add regression coverage for `.envrc`, `.env-prod`, and `.env_backup` exclusion from hosted workspace snapshots.
2. Tighten the hosted snapshot environment-file predicate to treat any basename starting with `.env` as sensitive.
3. Add regression coverage for complete Authorization/Cookie redaction in shared web logging.
4. Tighten shared web log redaction with explicit whole-header handling before generic secret redaction.
5. Run focused verification, required audit passes, and scoped commit.

## Verification

- Passed: `pnpm exec vitest run --config vitest.config.ts packages/runtime-state/test/hosted-bundle.test.ts --testNamePattern "env-prefixed|preserved artifact refs"`.
- Passed: `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/http.test.ts`.
- Passed: `pnpm --dir packages/runtime-state test`.
- Passed: `pnpm --dir apps/web verify`.
- Passed: `pnpm typecheck`.
- Passed before final sanitizer hardening: `pnpm test:diff packages/runtime-state/src/hosted-bundles.ts packages/runtime-state/test/hosted-bundle.test.ts apps/web/src/lib/http.ts apps/web/test/http.test.ts`.
- Post-hardening `test:diff` attempts hit unrelated verifier interruptions: one assistant-runtime checkpoint test failed once and passed on direct rerun; one CLI suite run was SIGTERM-terminated without an assertion and passed on direct rerun.
- Audit: `security-privacy-review` found a quoted/bracketed cookie redaction gap in the first sanitizer version; fixed with focused regression coverage.
- Audit: `coverage-write` added focused proof for `.runtime/operations/**/.envrc` snapshot exclusion and `cookie=` / `set-cookie=` redaction.
- Audit: `task-finish-review` found comma-bearing Authorization/Set-Cookie leakage in the second sanitizer version; fixed by making unquoted auth/cookie header strings fail closed through the next object boundary, with focused regression coverage.
Status: completed
Updated: 2026-05-24
Completed: 2026-05-24
