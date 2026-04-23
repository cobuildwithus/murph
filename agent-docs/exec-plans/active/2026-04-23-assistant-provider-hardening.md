# Land assistant provider hardening for host identity, API-key resolution, failover, and runtime classification

Status: active
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Fix the reported assistant-provider hardening issues without widening beyond the OpenAI-compatible preset/runtime resolution seams, hosted billing/delegation guards, API-key resolution and attribution alignment, and failover boundary behavior.

## Success criteria

- Lookalike or authority-bearing non-official URLs do not classify as OpenAI or Vercel AI Gateway presets anywhere in normalization, persistence, session/runtime parsing, or hosted bootstrap.
- Gateway-only provider behavior stays gated to the exact trusted gateway host and does not inject delegated Stripe headers or gateway options for custom endpoints.
- Effective execution does not resurrect blanked caller env API keys from ambient `process.env`, and attribution/billing classification follows the key actually used.
- OpenAI-compatible upstream auth/config/model/request failures stay terminal unless explicitly marked retryable, while existing non-replayable provider-work guards remain intact.
- Provider target normalization and runtime resolution use one consistent precedence model across operator-config, assistant-engine, and assistant-runtime.
- Focused regression tests cover the new boundary behavior and verification plus required audits run before handoff.

## Scope

- `packages/operator-config/src/assistant/{openai-compatible-provider-presets.ts,provider-config.ts,shared.ts,target-runtime.ts}`
- `packages/operator-config/src/{assistant-backend.ts,assistant-cli-contracts.ts}`
- `packages/operator-config/test/**`
- `packages/assistant-engine/src/{model-harness.ts}`
- `packages/assistant-engine/src/assistant/{failover.ts,provider-config.ts,provider-turn-runner.ts}`
- `packages/assistant-engine/src/assistant/providers/openai-compatible.ts`
- `packages/assistant-engine/test/**`
- `packages/assistant-runtime/src/hosted-runtime.ts`
- `packages/assistant-runtime/test/**`
- `packages/runtime-state/src/assistant-usage.ts`
- `packages/runtime-state/test/**`
- this plan plus `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`

## Constraints

- Preserve unrelated dirty-tree edits, especially the existing `packages/runtime-state/src/assistant-usage.ts` hard-cut cleanup.
- Keep the change narrowly behavior-preserving outside the reported security/billing/runtime invariants.
- Treat custom/proxy hosts as untrusted for gateway-only delegation unless the host is exactly `ai-gateway.vercel.sh`.
- Do not weaken failover or provider abstractions just to make the current tree pass.
- If exact-task commit staging would absorb unrelated dirty work, stop and document the blocker precisely.

## Decisions

- Treat OpenAI-compatible provider-native tool calls as provider work only when the AI SDK reports an executed provider tool call (`providerExecuted === true`), not merely when a native tool is configured.
- Count provider-native actions by unique `toolCallId` across completed step results (`onStepFinish`) and the final result payload so the implementation stays aligned with the installed AI SDK's real provider-executed surfaces without double-counting.
- Keep the failover gate itself unchanged in `provider-turn-runner`; the bug is in OpenAI-compatible attempt metadata, so the runner regression stays test-only.
- Operator-config now resolves OpenAI-compatible preset identity through one conservative precedence helper: explicit `custom` stays custom; otherwise an explicit `baseUrl` wins, with non-official hosts staying custom/openai-compatible instead of falling back to `presetId`, `providerName`, or API-key env heuristics.
- Exact official-host checks now parse URLs structurally and reject lookalike or userinfo-bearing authorities instead of relying on raw string-prefix matching.
- Vercel AI Gateway-only behavior in operator-config is now gated from the shared effective preset resolution path so stale gateway ids do not enable gateway-only options on custom endpoints.
- Assistant usage attribution now treats explicit credential-like provider headers as member-supplied auth and consults the actual attempt env before calling a hosted `apiKeyEnv` member-owned.
- Provider-turn and pending-usage persistence now pass route headers into `resolveAssistantUsageCredentialSource()` so header-authenticated OpenAI-compatible traffic no longer defaults to `platform`.
- CLI `--headersJson` parsing now rejects the same secret-like header names or credential-bearing values that the redaction layer already strips from persisted config/session state.

## State

- Implementation is complete and the required `simplify`, `coverage-write`, and `task-finish-review` audit passes all ran.
- The simplify pass found two real follow-ups in scope:
  - hosted-runtime delegated billing no longer falls back to `HOSTED_ASSISTANT_PROVIDER` when `HOSTED_ASSISTANT_BASE_URL` is absent
  - official-host preset resolution now refuses insecure `http://api.openai.com/...` and `http://ai-gateway.vercel.sh/...` inputs
- The final review also flagged a pending-usage filename compatibility risk in `packages/runtime-state/src/assistant-usage.ts`, but that file already carried concurrent out-of-scope churn for another lane and was intentionally left untouched here.
- No scoped commit was created because `agent-docs/exec-plans/active/COORDINATION_LEDGER.md` has unrelated concurrent churn; staging it through `scripts/finish-task` would absorb other rows/hunks outside this task.

## Verification

- Focused assistant-engine proof:
  - `pnpm exec vitest run packages/assistant-engine/test/provider-config.test.ts packages/assistant-engine/test/provider-continuity.test.ts packages/assistant-engine/test/provider-execution.test.ts packages/assistant-engine/test/failover.test.ts packages/assistant-engine/test/provider-turn-runner.test.ts packages/assistant-engine/test/model-harness-runtime.test.ts`
  - passed
- Focused runtime-state proof:
  - `pnpm --dir packages/runtime-state test -- assistant-usage.test.ts assistant-usage-path.test.ts`
  - `pnpm --dir packages/runtime-state typecheck`
  - passed
- Focused operator-config proof:
  - `pnpm --dir packages/operator-config exec vitest run --config vitest.config.ts test/assistant-provider-hardening.test.ts test/assistant-runtime-contracts-coverage.test.ts test/hosted-assistant-bootstrap.test.ts test/config-env.test.ts --no-coverage`
  - passed
- Focused assistant-runtime proof:
  - `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-platform.test.ts test/hosted-runtime-runner.test.ts --no-coverage`
  - passed after the simplify-driven hosted billing follow-up (`47` tests)
- Direct scenario proof:
  - `pnpm exec tsx --eval` confirmed exact official hosts classify as trusted while lookalike/userinfo hosts do not and normalize to custom `openai-compatible`
  - `pnpm exec tsx --eval` confirmed a blank explicit `OPENAI_API_KEY` env snapshot resolves to assistant model spec `apiKeyEnvValue: null`
  - `pnpm exec tsx --eval` confirmed `http://api.openai.com/v1` and `http://ai-gateway.vercel.sh/v1` now resolve to `presetId: null` and `executionDriver: openai-compatible`
- Diff hygiene:
  - `git diff --check -- packages/operator-config packages/assistant-engine packages/assistant-runtime packages/runtime-state agent-docs/exec-plans/active/2026-04-23-assistant-provider-hardening.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
  - passed
- Coverage-bearing lane / known unrelated blockers:
  - `bash scripts/workspace-verify.sh test:diff packages/operator-config packages/assistant-engine packages/assistant-runtime packages/runtime-state`
  - repeatedly failed outside this task's scope in reverse-dependent workspace checks (observed unrelated failures included `packages/assistant-cli`/`packages/core` export mismatches and separate `packages/assistantd` test/typecheck mismatches)
