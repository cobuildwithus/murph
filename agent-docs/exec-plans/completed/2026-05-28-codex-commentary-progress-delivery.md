Goal (incl. success criteria):
- Make model-authored progress updates a structural capability for user-facing assistant turns instead of conditional plumbing tied to final-response dispatch mode.
- Success: hosted Linq/iMessage queue-only turns still register exactly one Codex dynamic tool, `murph.send_progress_update`, while final responses continue to use the existing queue-only outbox path.

Constraints/Assumptions:
- Keep the existing `murph.send_progress_update` dynamic tool and current-audience progress delivery primitive.
- Do not add a model-facing final-response tool or parallel final-delivery path.
- Keep progress best-effort, deduped, capped, and metadata-only in hosted-local assertions.

Key decisions:
- Use the existing hosted-local Codex app-server shim as the validation point because it receives the actual JSON-RPC `thread/start` params.
- Gate validation behind a test-only expected dynamic-tools env var so unrelated hosted-local scenarios are not forced into a progress-enabled shape.
- Register the progress dynamic tool from user-facing turn policy, not from final outbox dispatch mode or a nullable progress sink.

State:
- Ready to close.

Done:
- Existing code path confirmed: `buildCodexThreadStartParams` includes `dynamicTools: [MURPH_SEND_PROGRESS_UPDATE_TOOL]` only when `turnProgress` exists.
- Existing Linq delivery E2E confirmed as the hosted-local iMessage-facing scenario.
- Added a test-only hosted Codex shim expected-dynamic-tools control and wired Linq delivery to require `murph.send_progress_update`.
- Extended the shim guard so `thread/resume` validates the expected dynamic tool was restored from the thread rollout rather than requiring unsupported `dynamicTools` resume params.
- Focused shim/config test passed: `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts test/hosted-runtime-codex-config.test.ts --no-coverage`.
- Supplemental Linq hosted-local run passed with the current runner bundle: `pnpm hosted-local e2e linq-delivery --no-bundle` (7 passed, 1 skipped).
- Focused typecheck passed: `pnpm --dir packages/assistant-runtime typecheck`.
- Truthful full bundle run `pnpm hosted-local e2e linq-delivery` assembled successfully but failed before any assistant provider request; hosted logs showed `assistant.input_candidates.listed` with `candidateCount: 0` and `assistant provider requests: []`, so the dynamic-tool shim was not reached.
- Refactored assistant-engine progress availability so the dynamic tool is exposed from model progress turn policy rather than queue-only final dispatch mode.
- Added resume-param coverage so progress-enabled resumed Codex turns include `murph.send_progress_update`.
- Kept progress delivery turn-scoped for dedupe/count but resolves current delivery context at send time for active-turn continuations.
- Guarded progress delivery on both the advertised model capability and the delivery sink.
- Subagent review completed with architecture/runtime/E2E/type-surface findings; in-scope high/medium findings were addressed.
- Focused assistant-engine regression suite passed: `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts test/assistant-turn-progress.test.ts test/assistant-codex-runtime.test.ts test/assistant-local-service-runtime.test.ts test/model-behavior.test.ts test/assistant-codex-final-coverage.test.ts --no-coverage`.
- Focused assistant-engine typecheck passed: `pnpm --dir packages/assistant-engine typecheck`.
- Focused hosted-runtime shim/config test passed again: `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts test/hosted-runtime-codex-config.test.ts --no-coverage`.
- Focused assistant-runtime typecheck passed: `pnpm --dir packages/assistant-runtime typecheck`.
- Latest hosted-local Linq E2E guard run `pnpm hosted-local e2e linq-delivery --no-bundle` failed before reaching Codex; logs again showed `candidateCount: 0` and `assistant provider requests: []`, so the dynamic-tool assertion was not exercised.

Now:
- Close plan and hand off.

Next:
- Re-run hosted-local Linq once the pre-provider candidate issue is fixed so the Codex shim assertion is exercised end to end.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `packages/assistant-engine/src/assistant/turn-progress.ts`
- `packages/assistant-engine/src/assistant-codex.ts`
- `packages/assistant-engine/src/assistant-codex/app-server-requests.ts`
- `packages/assistant-engine/src/assistant/local-service.ts`
- `packages/assistant-engine/src/assistant/codex-turn/**`
- `packages/assistant-engine/src/assistant/providers/**`
- `packages/assistant-engine/test/assistant-local-service-runtime.test.ts`
- `packages/assistant-engine/test/assistant-codex-runtime.test.ts`
- `packages/assistant-runtime/src/hosted-runtime/codex-e2e-app-server-stub.ts`
- `packages/assistant-runtime/src/hosted-runtime/launch-spec.ts`
- `packages/assistant-runtime/src/hosted-runtime-contracts.ts`
- `packages/assistant-runtime/src/hosted-runtime-worker-contracts.ts`
- `packages/assistant-runtime/test/hosted-runtime-codex-config.test.ts`
- `scripts/dev-hosted-local/constants.ts`
- `apps/cloudflare/src/hosted-env-policy.ts`
- `apps/cloudflare/test/hosted-local-linq-first-contact-e2e.test.ts`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
Status: completed
Updated: 2026-05-28
Completed: 2026-05-28
