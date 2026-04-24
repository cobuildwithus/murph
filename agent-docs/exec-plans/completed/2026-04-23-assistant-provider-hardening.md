# Harden assistant provider authority, tool exposure, failover, and runtime surfaces

Status: completed
Created: 2026-04-23
Updated: 2026-04-24

## Goal

- Fix the reported assistant-provider authority and tool-surface issues without widening beyond provider-turn catalog planning, operator-authority resolution, failover session recovery, CLI helper boundaries, OpenAI-compatible web/tool routing, capability metadata, and directly coupled tests.

## Success criteria

- Provider-turn tool exposure is authority-scoped, and accepted inbound turns do not receive direct-only helpers such as CLI execution, canonical write, knowledge-write, automation-write, outward side-effect, or Murph web-read helper tools unless a future turn type explicitly grants them.
- Missing or invalid untrusted operator authority fails closed, while any intentionally trusted direct-operator default is isolated behind an explicit resolver.
- Provider failover retries carry recovered session state forward to later routes and exhausted outcomes.
- CLI surface bootstrap caching cannot leak a context-specific manifest across vault, working-directory, execution-context, or env boundaries.
- Provider-turn CLI execution rejects caller-supplied config files, preserving the active vault/context boundary.
- Native or gateway web-search routing does not expose Murph `web.fetch` or `web.pdf.read` helpers unless Murph web-read helpers are enabled for the route.
- Read-only self-target helpers are classified as read-only, provider-visible OpenAI-compatible tool aliases are centralized for prompt/contract use, non-tool-runtime routes receive no tool runtime, and the unused provider resume-key parameter is removed or made meaningful.
- Focused regression tests cover the boundary behavior and verification plus required audits run before handoff.

## Scope

- `packages/operator-config/src/assistant/{openai-compatible-provider-presets.ts,provider-config.ts,shared.ts,target-runtime.ts}`
- `packages/operator-config/src/{assistant-backend.ts,assistant-cli-contracts.ts}`
- `packages/operator-config/test/**`
- `packages/assistant-engine/src/{model-harness.ts}`
- `packages/assistant-engine/src/assistant/{cli-surface-bootstrap.ts,conversation-policy.ts,cron/execution.ts,failover.ts,operator-authority.ts,provider-binding.ts,provider-config.ts,provider-turn-runner.ts,service-contracts.ts,system-prompt.ts}`
- `packages/assistant-engine/src/assistant-cli-tools/{catalog-profiles.ts,policy-wrappers.ts}`
- `packages/assistant-engine/src/assistant/providers/openai-compatible.ts`
- `packages/assistant-engine/test/**`
- `packages/assistant-cli/src/assistant/service.ts`
- `packages/assistantd/src/service.ts`
- `packages/assistant-runtime/src/hosted-runtime.ts`
- `packages/assistant-runtime/test/**`
- `packages/runtime-state/src/assistant-usage.ts`
- `packages/runtime-state/test/**`
- this plan plus `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`

## Constraints

- Preserve unrelated dirty-tree edits, especially the existing `packages/runtime-state/src/assistant-usage.ts` hard-cut cleanup.
- Preserve the existing stale completed-state notes below as historical context, but make the new implementation state explicit before handoff.
- Keep the change narrowly behavior-preserving outside the reported security/runtime invariants.
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

- Current 2026-04-24 authority/tool-surface hardening slice is implemented and verified with focused assistant-engine, assistant-cli, and assistantd proof.
- The final review finding in `packages/assistantd/src/service.ts` was fixed: trusted-local daemon message forwarding now defaults omitted `operatorAuthority` to `direct-operator` before validation/forwarding while preserving explicit `accepted-inbound-message`.
- Existing plan content below records the previous provider-hardening slice and remains historical until this plan is closed.
- No scoped commit is safe from this worktree: the shared coordination ledger has unrelated concurrent churn, and several touched files also carry adjacent in-progress work from other active rows. Closing/archive is required instead of `scripts/finish-task`.

## Previous slice state

- Implementation is complete and the required `simplify`, `coverage-write`, and `task-finish-review` audit passes all ran.
- The simplify pass found two real follow-ups in scope:
  - hosted-runtime delegated billing no longer falls back to `HOSTED_ASSISTANT_PROVIDER` when `HOSTED_ASSISTANT_BASE_URL` is absent
  - official-host preset resolution now refuses insecure `http://api.openai.com/...` and `http://ai-gateway.vercel.sh/...` inputs
- The final review also flagged a pending-usage filename compatibility risk in `packages/runtime-state/src/assistant-usage.ts`, but that file already carried concurrent out-of-scope churn for another lane and was intentionally left untouched here.
- No scoped commit was created because `agent-docs/exec-plans/active/COORDINATION_LEDGER.md` has unrelated concurrent churn; staging it through `scripts/finish-task` would absorb other rows/hunks outside this task.

## Verification

- Current 2026-04-24 assistant authority/tool-surface proof:
  - `pnpm --dir packages/assistant-engine exec vitest run test/assistant-product-small-seams.test.ts test/assistant-cli-tool-catalog.test.ts test/assistant-cli-tools-capabilities.test.ts test/assistant-cli-surface-bootstrap.test.ts test/system-prompt.test.ts test/provider-turn-runner.test.ts test/provider-seams.test.ts test/provider-execution.test.ts --config vitest.config.ts --no-coverage`
  - passed (`118` tests)
- Current assistant package owner proof:
  - `pnpm --dir packages/assistant-cli test:coverage`
  - `pnpm --dir packages/assistantd exec vitest run test/service-coverage.test.ts --config vitest.config.ts --no-coverage`
  - `pnpm --dir packages/assistantd test:coverage`
  - passed
- Current type proof:
  - `pnpm --dir packages/assistant-engine typecheck`
  - `pnpm --dir packages/assistant-cli typecheck`
  - `pnpm --dir packages/assistantd typecheck`
  - passed
- Current completion audits:
  - required simplify audit completed; findings were fixed by keying CLI bootstrap cache on effective env, keeping provider-turn CLI catalog options local, and removing an unused provider-capabilities parameter.
  - required coverage-write audit completed with no additional edits.
  - required task-finish-review audit completed; one daemon authority default finding was fixed and covered in `packages/assistantd/test/service-coverage.test.ts`.
- Current diff hygiene:
  - `git diff --check -- <current task files>`
  - passed
- Current known unrelated blockers:
  - `pnpm typecheck` failed after the touched assistant package typechecks passed because `apps/cloudflare/test/runner-container.test.ts` has an unrelated `HostedAssistantRuntimeJobRequest` fixture missing `runDrain.committedResult.bundle`.
  - `bash scripts/workspace-verify.sh test:diff <current task files>` failed after assistant package typechecks passed in unrelated reverse-dependent `packages/cli` test typechecking.
  - A later broad `pnpm --dir packages/assistant-engine test:coverage` run failed in `packages/assistant-engine/test/assistant-automation-runtime.test.ts` after unrelated active automation edits appeared; the focused assistant-engine regression slice remained green.
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
Completed: 2026-04-24
