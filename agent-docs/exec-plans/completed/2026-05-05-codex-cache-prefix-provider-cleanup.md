# Codex Cache Prefix Provider Cleanup

Status: completed
Created: 2026-05-05
Updated: 2026-05-06

## Goal

Simplify the hosted-local Codex provider routing fix so the effective provider id is computed by Codex runtime preparation and passed through one explicit runtime-env contract instead of being re-derived from the provider-base env inside hosted assistant context.

## Success criteria

- `codex-config.ts` sets one explicit effective provider-id runtime env value.
- Hosted assistant context does not import Codex config internals or inspect the local test provider-base env.
- Production behavior remains unchanged when the provider id is `openai`.
- Focused tests and the cache-prefix gate still pass.

## Scope

- `packages/assistant-runtime/src/hosted-runtime/codex-config.ts`
- `packages/assistant-runtime/src/hosted-runtime/codex-runtime-env.ts`
- `packages/assistant-runtime/src/hosted-runtime/context.ts`
- Focused hosted-runtime tests.

## Verification

- Passed: `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts test/hosted-runtime-codex-config.test.ts test/hosted-runtime-codex-local-provider-target.test.ts test/hosted-runtime-context.test.ts --no-coverage`.
- Passed: `pnpm typecheck`.
- Passed: `HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS='' MURPH_HOSTED_LOCAL_E2E_FAST_GATE=1 pnpm hosted-local e2e codex-gateway-prefix --profile e2e:live`.
- Passed: `git diff --check` on the scoped cleanup files.
- Attempted: scoped `bash scripts/workspace-verify.sh test:diff ...` for the cleanup files. It failed in package-wide assistant-runtime tests on unrelated existing failures in `test/hosted-runtime-codex-self-brick-e2e.test.ts` and `test/hosted-runtime-environment.test.ts`.
- Completion reviews: security/privacy no findings; coverage-write made no edits; final review found no code issues.
Completed: 2026-05-06
