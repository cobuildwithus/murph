# Codex Cache Prefix Local Provider Routing

Status: completed
Created: 2026-05-05
Updated: 2026-05-05

## Goal

Make the hosted-local Codex cache-prefix E2E gate route test-mode Codex model requests through the local Responses recorder while preserving production hosted OpenAI routing.

## Success criteria

- When `HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL` is set under `NODE_ENV=test`, hosted runtime Codex config and the in-memory assistant default target agree on the local test provider id.
- Production hosted execution still requires `HOSTED_ASSISTANT_PROVIDER=openai` and does not expose or persist the local test provider as a product/provider option.
- The focused hosted-runtime regression tests and the `codex-gateway-prefix` hosted-local gate pass.

## Scope

- In scope:
  - `packages/assistant-runtime/src/hosted-runtime/codex-config.ts`
  - `packages/assistant-runtime/src/hosted-runtime/context.ts`
  - Focused hosted-runtime tests for the local test provider override and hydrated default target.
- Out of scope:
  - Generic assistant provider registry changes.
  - Production hosted provider selection changes.
  - Cloudflare runner env policy beyond existing OpenAI requirements.

## Constraints

- Preserve unrelated dirty work in the current checkout.
- Keep the test provider local to hosted runtime harness behavior.
- Do not log or fixture provider credentials.

## Tasks

1. Add a hosted-runtime helper that resolves the active Codex model provider id for the local recorder override.
2. Apply that helper only when hydrating the hosted assistant default target.
3. Add focused regression coverage for production/no-override and test/local-override behavior.
4. Run focused package tests, typecheck, and the cache-prefix E2E gate.
5. Run required completion review checks and commit if scoped staging is safe.

## Verification

- PASS: `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts test/hosted-runtime-codex-config.test.ts test/hosted-runtime-codex-local-provider-target.test.ts test/hosted-runtime-context.test.ts --no-coverage`
- PASS: `pnpm typecheck`
- PASS: `HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS='' MURPH_HOSTED_LOCAL_E2E_FAST_GATE=1 pnpm hosted-local e2e codex-gateway-prefix --profile e2e:live`
- PASS: `git diff --check -- packages/assistant-runtime/src/hosted-runtime/codex-config.ts packages/assistant-runtime/src/hosted-runtime/context.ts packages/assistant-runtime/test/hosted-runtime-codex-config.test.ts packages/assistant-runtime/test/hosted-runtime-codex-local-provider-target.test.ts agent-docs/exec-plans/active/2026-05-05-codex-cache-prefix-local-provider.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- PASS: scoped diff privacy scan found no home paths, local account usernames, Authorization headers, bearer tokens, or raw key-looking values.
- BLOCKED/UNRELATED: `bash scripts/workspace-verify.sh test:diff packages/assistant-runtime/src/hosted-runtime/codex-config.ts packages/assistant-runtime/src/hosted-runtime/context.ts packages/assistant-runtime/test/hosted-runtime-codex-config.test.ts packages/assistant-runtime/test/hosted-runtime-context.test.ts` reached the full `packages/assistant-runtime test` lane and failed in pre-existing dirty-branch tests outside this change: `test/hosted-runtime-codex-self-brick-e2e.test.ts` still expects a built-in OpenAI provider block with `wire_api`, and `test/hosted-runtime-environment.test.ts` expects a device-sync provider config without current optional `undefined` fields.
- Reviews:
  - PASS: security/privacy review found no findings.
  - PASS: task-finish review found no findings after noting an optional default-target unit coverage gap; added `packages/assistant-runtime/test/hosted-runtime-codex-local-provider-target.test.ts`.
Completed: 2026-05-05
