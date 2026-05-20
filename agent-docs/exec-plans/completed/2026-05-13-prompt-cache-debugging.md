# Prompt Cache Debugging

## Goal

Find why recent Murph assistant turns appear not to receive OpenAI prompt-cache
hits, then make the smallest durable fix if the repo request path or usage
accounting is wrong.

## Success Criteria

- The OpenAI/Codex request path and usage parsing path are traced.
- Recent diagnostics are inspected only through redacted metadata.
- Any code fix preserves provider-secret and transcript privacy boundaries.
- Focused tests cover the root cause, or the blocker is documented with exact
  evidence.

## Scope

- `packages/assistant-engine/**`
- `packages/assistant-runtime/**`
- `packages/operator-config/**`
- `packages/cli/**`
- `apps/cloudflare/src/runner-egress-intercept.ts`
- `apps/cloudflare/src/worker-contracts.ts`
- `apps/cloudflare/scripts/deploy-automation/**`
- `.github/workflows/deploy-cloudflare-hosted.yml`
- `apps/cloudflare/test/runner-egress-intercept.test.ts`
- `apps/cloudflare/test/deploy-*.test.ts`
- `apps/web/test/hosted-workspace-store.test.ts`
- `apps/cloudflare/README.md`
- `apps/cloudflare/DEPLOY.md`
- `apps/cloudflare/test/hosted-local-codex-long-thread-e2e.test.ts`
- hosted-local E2E harness/test helpers for offline provider diagnostics
- hosted runtime log event contract/tests
- hosted Codex/OpenAI config surfaces if evidence points there
- focused provider usage and prompt-cache tests

## Out Of Scope

- Printing prompt/message/transcript contents.
- Pulling or exposing environment secrets.
- Broad provider migrations or model upgrades.
- Broad deploy changes unrelated to prompt-cache diagnostics.

## Plan

1. Confirm current OpenAI prompt-caching requirements from official docs.
2. Trace request construction, state reuse, cache-key/retention settings, and
   usage parsing.
3. Inspect recent local runtime/provider diagnostics for cached-token metadata
   only.
4. Patch the smallest wrong layer if found.
5. Add metadata-only egress diagnostics if the provider request path is
   correct but insufficiently observable.
6. Require Worker-owned diagnostic fingerprinting in hosted deploy preflight.
7. Run focused verification for touched owners.

## Diagnostic Design Notes

- OpenAI Responses diagnostics live at the Cloudflare runner egress boundary
  and use the existing hosted runtime-log write path.
- Durable diagnostic payloads are metadata-only: counts, byte lengths,
  presence booleans, model/cache-retention kinds, and keyed fingerprints.
- Request/input/cache identifiers use HMAC-SHA256 fingerprints when
  `HOSTED_LOG_FINGERPRINT_SECRET` is configured; raw prompts, messages,
  request bodies, headers, secrets, cache keys, and previous response ids are
  not logged.
- Arbitrary request-body model strings collapse to `other` unless they are a
  small allowlisted public model kind.
- `waitUntil` is an optional scheduler only. When the container outbound path
  lacks it, the provider fetch starts before the diagnostic is awaited and the
  runtime log is still persisted.
- Full-body JSON parsing and full-body fingerprints are capped; prefix
  fingerprints remain bounded to fixed windows.
- Production OpenAI egress diagnostics summarize Responses `input` shape with
  allowlisted type/role buckets, largest-item byte size/kinds, and compact
  nested `content`/`output`/string count-byte metrics. The summary is bounded
  by request JSON size, traversal depth, traversal node count, runtime-log
  field count, and runtime-log array length; subtree byte measurement is
  best-effort so extreme nesting cannot drop the whole diagnostic.
- Production OpenAI egress diagnostics also summarize the bounded input tail
  with item indexes, reverse indexes, role/type buckets, JSON byte sizes,
  `content`/`output`/string byte totals, and optional HMAC fingerprints. This
  lets a warm-cache uncached suffix be traced to recent message/tool/provider
  items without logging prompt or message content.
- Provider prompt-size diagnostics live at the Codex provider prompt
  composition boundary and emit only byte counts, presence booleans, and
  prompt-plan enums. Prompt text, developer instructions, message bodies,
  route ids, and provider session ids are not logged.
- Provider prompt-size diagnostics now split the composed prompt into system
  prompt, active-turn replay, conversation context, runtime context, developer
  instructions, and user prompt byte counts so production logs can compare the
  Murph-composed prompt against the final OpenAI request size.
- Session-resolution diagnostics live on the assistant session lookup result
  and emit only lookup source, key counts, indexed-candidate counts, matched
  scope, and indexed booleans. Raw lookup keys and session ids are not logged.
- The manual `codex-long-thread` hosted-local scenario exercises the real
  hosted Linq wake/runtime/Codex request-construction path against a local
  Responses API recorder, so it can reproduce prompt growth and compaction
  without real provider credits. Because the model provider base URL points to
  loopback in this scenario, Worker OpenAI egress diagnostics are not expected
  there; the scenario records metadata-only provider body sizes, keyed fingerprints,
  compact request counts, usage-token checkpoints, and post-compaction drops.

## Verification

- `pnpm exec vitest run packages/assistant-engine/test/codex-runtime-helpers.test.ts packages/hosted-execution/test/assistant-usage.test.ts` passed.
- `pnpm exec tsc --noEmit --pretty false --project packages/assistant-engine/tsconfig.json` passed.
- `pnpm exec tsc --noEmit --pretty false --project packages/hosted-execution/tsconfig.json` passed.
- `pnpm hosted-local e2e codex-gateway-prefix --profile e2e:live` passed.
- `pnpm typecheck` stopped on a pre-existing repo tools/contracts export mismatch in `scripts/verify.ts` before reaching touched package failures.
- `pnpm test` reached broad Repo Vitest, opened an interactive setup prompt, and was terminated; focused tests above cover the changed usage parsing.
- `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts test/runner-egress-intercept.test.ts` passed.
- `pnpm --dir packages/hosted-execution exec vitest run --config vitest.config.ts test/hosted-runtime-control.test.ts` passed.
- `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-workspace-store.test.ts` passed.
- `pnpm --dir apps/cloudflare typecheck` passed.
- `pnpm --dir packages/hosted-execution typecheck` passed.
- `pnpm --dir apps/web typecheck` passed.
- `pnpm logs:guard` passed.
- `pnpm exec vitest run packages/assistant-engine/test/codex-runtime-helpers.test.ts packages/assistant-engine/test/assistant-hosted-context-diagnostics.test.ts packages/cli/test/assistant-state.test.ts` passed.
- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts test/hosted-runtime-events.test.ts` passed.
- `pnpm --dir packages/assistant-engine typecheck` passed.
- `pnpm --dir packages/cli typecheck` passed.
- `pnpm exec tsc --noEmit --pretty false --project packages/assistant-runtime/tsconfig.json` passed.
- `pnpm logs:guard` passed after the prompt-size/session-lookup diagnostics update.
- `pnpm typecheck` was attempted after the prompt-size/session-lookup
  diagnostics update, but it blocked behind an unrelated long-running
  Cloudflare runner-bundle workspace lock before package checks could start.
- `pnpm exec vitest run --config scripts/vitest.config.ts scripts/hosted-local.test.ts` passed after wiring the manual `codex-long-thread` scenario.
- `pnpm --dir apps/cloudflare typecheck` passed after the hosted-local long-thread harness additions.
- `pnpm --dir apps/web typecheck:prepared` passed after the hosted test diagnostic helper additions.
- `MURPH_HOSTED_LOCAL_ARTIFACT_DIR=.artifacts/codex-long-thread MURPH_E2E_CODEX_LONG_THREAD_TURN_COUNT=75 pnpm hosted-local e2e codex-long-thread --profile e2e:live` passed. Metadata-only diagnostic summary: 75 completed turns, 75 usage rows, 79 provider requests, 4 compact requests, max estimated body tokens 50,488, max usage input tokens 50,487, and post-compaction request body drops instead of unbounded growth. No real OpenAI credits were used because the provider base URL was a local recorder.
- `MURPH_DEV_SKIP_RUNNER_BUNDLE=1 MURPH_HOSTED_LOCAL_ARTIFACT_DIR=.artifacts/codex-long-thread-final MURPH_E2E_CODEX_LONG_THREAD_TURN_COUNT=12 pnpm hosted-local e2e codex-long-thread --profile e2e:live` passed after adding explicit summary fields. Metadata-only diagnostic summary: first usage row over target at ordinal 11, max usage input tokens 50,111, one compact request, and one usage-token drop from 50,111 to 12,751 on the next assistant turn.
- `git diff --check -- agent-docs/exec-plans/active/2026-05-13-prompt-cache-debugging.md apps/cloudflare/test/helpers/hosted-local-e2e-support.ts apps/cloudflare/test/helpers/hosted-local-full-stack-scenario.ts apps/cloudflare/test/hosted-local-codex-long-thread-e2e.test.ts apps/web/src/lib/hosted-onboarding/hosted-member-test-seed.ts apps/web/src/testing.ts packages/hosted-local-harness/src/e2e.ts scripts/hosted-local.test.ts` passed.
- `pnpm logs:guard` passed.
- `bash scripts/workspace-verify.sh test:diff agent-docs/exec-plans/active/2026-05-13-prompt-cache-debugging.md apps/cloudflare/test/helpers/hosted-local-e2e-support.ts apps/cloudflare/test/helpers/hosted-local-full-stack-scenario.ts apps/cloudflare/test/hosted-local-codex-long-thread-e2e.test.ts apps/web/src/lib/hosted-onboarding/hosted-member-test-seed.ts apps/web/src/testing.ts packages/hosted-local-harness/src/e2e.ts scripts/hosted-local.test.ts` passed, including repo tools tests, hosted-local-harness typecheck, `apps/cloudflare verify`, and `apps/web verify`. The web lane still emitted existing lint warnings in `device-sync/agent-session-service.ts` plus the known Turbopack trace warning.
- Post-audit fixes added explicit compaction/drop assertions, stable usage-row ordering by provider request ordinal, and per-run local HMAC keys for provider request body fingerprints.
- `pnpm exec vitest run --config scripts/vitest.config.ts scripts/hosted-local.test.ts` passed after post-audit fixes.
- `pnpm --dir apps/cloudflare typecheck` passed after post-audit fixes.
- `pnpm --dir apps/web typecheck:prepared` passed after post-audit fixes.
- `MURPH_HOSTED_LOCAL_ARTIFACT_DIR=.artifacts/codex-long-thread-assertions MURPH_E2E_CODEX_LONG_THREAD_TURN_COUNT=12 pnpm hosted-local e2e codex-long-thread --profile e2e:live` passed with the explicit compaction/drop assertions enabled. Metadata-only diagnostic summary: first usage row over target at ordinal 11, max usage input tokens 50,111, one compact request, one request-body drop from 200,444 bytes to 51,004 bytes, and one usage-token drop from 50,111 to 12,751.
- Final review narrowed request-body drop detection to compare normal `/v1/responses` calls only, so the E2E proves the post-compact assistant turn shrinks instead of counting the compact call itself.
- `MURPH_HOSTED_LOCAL_ARTIFACT_DIR=.artifacts/codex-long-thread-final-proof MURPH_E2E_CODEX_LONG_THREAD_TURN_COUNT=12 pnpm hosted-local e2e codex-long-thread --profile e2e:live` passed after that narrowing. Metadata-only diagnostic summary: 12 completed turns, first usage row over target at ordinal 11, max usage input tokens 50,111, one compact request, normal response body drop from 200,442 bytes to 51,004 bytes, and usage-token drop from 50,111 to 12,751.
- Final scoped `git diff --check` passed, the untracked long-thread E2E file passed `git diff --no-index --check`, and `pnpm logs:guard` passed.
- `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts test/runner-egress-intercept.test.ts` passed after adding production input-shape diagnostics.
- `pnpm exec vitest run packages/assistant-engine/test/codex-runtime-helpers.test.ts` passed after adding provider prompt-section byte diagnostics.
- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts test/hosted-runtime-events.test.ts` passed after allowing the new hosted prompt-size diagnostic fields.
- `pnpm --dir apps/cloudflare typecheck` passed.
- `pnpm --dir packages/assistant-engine typecheck` passed.
- `pnpm exec tsc --noEmit --pretty false --project packages/assistant-runtime/tsconfig.json` passed.
- `pnpm logs:guard` passed.
- `git diff --check -- apps/cloudflare/src/runner-egress-intercept.ts apps/cloudflare/test/runner-egress-intercept.test.ts packages/assistant-engine/src/assistant/providers/codex-cli.ts packages/assistant-engine/src/assistant/providers/helpers.ts packages/assistant-engine/test/codex-runtime-helpers.test.ts packages/assistant-runtime/src/hosted-runtime/events.ts packages/assistant-runtime/test/hosted-runtime-events.test.ts` passed.
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/runner-egress-intercept.ts apps/cloudflare/test/runner-egress-intercept.test.ts packages/assistant-engine/src/assistant/providers/codex-cli.ts packages/assistant-engine/src/assistant/providers/helpers.ts packages/assistant-engine/test/codex-runtime-helpers.test.ts packages/assistant-runtime/src/hosted-runtime/events.ts packages/assistant-runtime/test/hosted-runtime-events.test.ts` was attempted after the final diagnostics update. It reached the packages/cli test lane and failed on unrelated dirty Murph Age CLI/schema expectations in `packages/cli/test/murph-age-command.test.ts` and `packages/cli/test/cli-typed-agent-inputs-schema.test.ts`; the diagnostics diff does not touch those files or the Murph Age feature.
- OpenAI docs checked for the final warm-cache suffix diagnosis: prompt caching
  is exact-prefix based, stable content should stay at the beginning, dynamic
  user-specific context should stay near the end, and cached-token metrics are
  the right signal to monitor.
- `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts test/runner-egress-intercept.test.ts` passed after adding tail-item diagnostics.
- `pnpm --dir apps/cloudflare typecheck` passed after adding tail-item diagnostics.
- `pnpm logs:guard` passed after adding tail-item diagnostics.
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/runner-egress-intercept.ts apps/cloudflare/test/runner-egress-intercept.test.ts` initially passed after adding tail-item diagnostics, including `apps/cloudflare verify` with 77 test files and 1040 tests passing. After the coverage worker added the explicit tail-bound test, rerunning the same command reached `apps/cloudflare verify` and failed on unrelated dirty direct-R2 snapshot-session work in `apps/cloudflare/test/user-runner-alarm.test.ts` (`best-effort deletes the previous workspace snapshot object when replacing the active upload session` expected the previous object key in `bucket.deleted` but saw `[]`); the prompt-cache diagnostic diff does not touch that snapshot-session path.
- `pnpm typecheck` passed after adding tail-item diagnostics.
Status: completed
Updated: 2026-05-20
Completed: 2026-05-20
