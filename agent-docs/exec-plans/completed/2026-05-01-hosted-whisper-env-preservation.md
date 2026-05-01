# Hosted Whisper Env Preservation

## Goal

Root-cause and fix why the hosted Cloudflare runner can have the baked Whisper CLI/model env in the container image while the hosted runtime process observes `WHISPER_MODEL_PATH` as unset.

Success criteria:

- The hosted runtime process scope preserves platform-owned native parser env from the container when the Worker runtime envelope omits those optional vars.
- User/env override policy still denies user-controlled executable selectors.
- Focused tests prove the env boundary.

## Constraints

- Preserve unrelated active hosted runner, Linq/audio, Junction, and local-dev dirty work.
- Do not print or persist secrets, raw identifiers, local host paths, or personal identifiers.
- Keep the fix scoped to the hosted runtime env boundary unless verification exposes a directly coupled caller/test.

## Current Diagnosis

- Docker base/final images set and contain the Whisper model path.
- Deploy/local Worker config generation skips blank optional Whisper vars.
- `withHostedProcessEnvironment()` rebuilds `process.env` from a narrow base allowlist plus runtime overrides, and that base allowlist currently drops platform-owned native parser env when the runtime envelope omits it.

## Plan

1. Preserve operator-owned parser tool selector env in the hosted runtime base process env.
2. Add focused regression coverage for `withHostedProcessEnvironment()`.
3. Run focused assistant-runtime and Cloudflare env tests plus direct container/parser probes where possible.
4. Run required completion audits/checks per repo workflow.

## Verification

- Source env-scope probe: passed. `WHISPER_COMMAND` and `WHISPER_MODEL_PATH` survive `withHostedProcessEnvironment()` when only ambient container env supplies them.
- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts test/hosted-runtime-environment.test.ts --no-coverage`: passed.
- `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts test/runner-env.test.ts test/runner-child-launcher.test.ts --no-coverage`: passed.
- `pnpm --dir packages/assistant-runtime test:coverage`: passed.
- `bash scripts/workspace-verify.sh test:diff packages/assistant-runtime/src/hosted-runtime/environment.ts packages/assistant-runtime/test/hosted-runtime-environment.test.ts`: passed.
- `pnpm --dir packages/assistant-runtime build` plus built `dist` env-scope probe: passed.
- `pnpm typecheck`: blocked outside this patch by active `apps/cloudflare/src/hosted-runner-smoke-child.ts` Python smoke-child type mismatches.
- `pnpm --dir apps/cloudflare runner:bundle`: blocked outside this patch by the same active hosted-runner smoke-child type mismatches.
Status: completed
Updated: 2026-05-01
Completed: 2026-05-01
