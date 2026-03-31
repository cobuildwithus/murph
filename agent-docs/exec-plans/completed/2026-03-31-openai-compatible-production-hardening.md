# 2026-03-31 OpenAI-Compatible Production Hardening

## Goal

Land the supplied assistant-runtime patch so OpenAI-compatible turns use the same canonical bound-tool runtime as the turn runner, assistant memory tools respect `allowSensitiveHealthContext` and `sessionId`, shared cron target tooling gains the missing target show/set surfaces plus direct outbound routing fields, and failover/observability behavior matches actual tool execution.

## Scope

- `agent-docs/exec-plans/active/2026-03-31-openai-compatible-production-hardening.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `packages/cli/src/{assistant-cli-tools,model-harness}.ts`
- `packages/cli/src/assistant/{cron,provider-turn-runner,session-resolution}.ts`
- `packages/cli/src/assistant/providers/{openai-compatible,types}.ts`
- `packages/cli/test/{assistant-provider,assistant-robustness,assistant-service}.test.ts`
- durable docs only if the landed behavior changes repo truth

## Risks

- accidentally widening tool access for OpenAI-compatible turns instead of preserving the active-vault-only boundary
- misclassifying provider failures after tool execution and replaying non-failoverable turns
- breaking cron target default resolution or outbound routing when add/install/set share the same target plumbing

## Verification

- Passed: `pnpm --dir packages/cli exec vitest run test/assistant-provider.test.ts test/assistant-robustness.test.ts test/assistant-service.test.ts`
- Passed: `pnpm typecheck`
- Failed for unrelated pre-existing repo state: `pnpm test`
  - unrelated package-resolution/build failures in `packages/cli/test/{canonical-mutation-boundary,canonical-write-lock,assistant-cli-access,incur-smoke,release-script-coverage-audit,inbox-cli}.test.ts`
  - unrelated runtime/test failures in `packages/cli/test/{list-cursor-compat,runtime,assistant-runtime}.test.ts` and `packages/inboxd/test/inboxd.test.ts`
- Failed for unrelated pre-existing repo/tooling state: `pnpm test:coverage`
  - `scripts/workspace-verify.sh test:coverage` could not launch `@cobuild/repo-tools/bin/cobuild-doc-gardening` from the current install path

## Status

Completed during this turn; no durable doc updates were needed because the landed runtime behavior already matched repo-level truth.
