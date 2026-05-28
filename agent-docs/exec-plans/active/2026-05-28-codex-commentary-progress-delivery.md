Goal (incl. success criteria):
- Add a hosted-local Linq/iMessage E2E guard that proves the first Codex `thread/start` request exposes exactly one dynamic tool, `murph.send_progress_update`, whenever the hosted turn has a current-turn progress sink.
- Success: the Linq delivery scenario fails if the Codex app-server shim receives no dynamic tool, more than one dynamic tool, or a different dynamic tool on `thread/start`, and the guard uses metadata-only validation without logging prompts, messages, secrets, or local paths.

Constraints/Assumptions:
- Keep the existing `murph.send_progress_update` dynamic tool and `AssistantTurnProgress` current-audience delivery primitive.
- Do not broaden provider progress forwarding or add a parallel progress-delivery abstraction.
- Keep the hosted-local check narrow, test-only, and metadata-only.

Key decisions:
- Use the existing hosted-local Codex app-server shim as the validation point because it receives the actual JSON-RPC `thread/start` params.
- Gate validation behind a test-only expected dynamic-tools env var so unrelated hosted-local scenarios are not forced into a progress-enabled shape.

State:
- Active.

Done:
- Existing code path confirmed: `buildCodexThreadStartParams` includes `dynamicTools: [MURPH_SEND_PROGRESS_UPDATE_TOOL]` only when `turnProgress` exists.
- Existing Linq delivery E2E confirmed as the hosted-local iMessage-facing scenario.
- Added a test-only hosted Codex shim expected-dynamic-tools control and wired Linq delivery to require `murph.send_progress_update`.
- Extended the shim guard so `thread/resume` validates the expected dynamic tool was restored from the thread rollout rather than requiring unsupported `dynamicTools` resume params.
- Focused shim/config test passed: `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts test/hosted-runtime-codex-config.test.ts --no-coverage`.
- Supplemental Linq hosted-local run passed with the current runner bundle: `pnpm hosted-local e2e linq-delivery --no-bundle` (7 passed, 1 skipped).
- Focused typecheck passed: `pnpm --dir packages/assistant-runtime typecheck`.
- Truthful full bundle run `pnpm hosted-local e2e linq-delivery` assembled successfully but failed before any assistant provider request; hosted logs showed `assistant.input_candidates.listed` with `candidateCount: 0` and `assistant provider requests: []`, so the dynamic-tool shim was not reached.

Now:
- Completion review and handoff.

Next:
- Investigate the full-bundle Linq input-candidate regression separately from the dynamic-tool shim guard if needed.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `packages/assistant-runtime/src/hosted-runtime/codex-e2e-app-server-stub.ts`
- `packages/assistant-runtime/src/hosted-runtime/launch-spec.ts`
- `packages/assistant-runtime/src/hosted-runtime-contracts.ts`
- `packages/assistant-runtime/src/hosted-runtime-worker-contracts.ts`
- `packages/assistant-runtime/test/hosted-runtime-codex-config.test.ts`
- `scripts/dev-hosted-local/constants.ts`
- `apps/cloudflare/src/hosted-env-policy.ts`
- `apps/cloudflare/test/hosted-local-linq-first-contact-e2e.test.ts`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
