Goal (incl. success criteria):
- Prevent hosted Telegram assistant replies from failing before delivery when a stale non-OpenAI Responses provider session id is present.
- Success: OpenAI Responses turns only send `previousResponseId` for ids that look like native OpenAI response ids, while fresh turns and valid `resp_*` continuation still work.

Constraints/Assumptions:
- Keep the fix narrow to assistant-engine provider options and focused tests.
- Preserve unrelated dirty work in the shared checkout and do not overwrite active assistant-engine lanes.
- Do not log or fixture raw contact identifiers, message bodies, provider payloads, secrets, local paths, or personal identifiers.

Key decisions:
- Treat incompatible stored resume ids as a fresh Responses turn for the upstream request; a later successful turn can replace state with a valid response id.
- Do not mutate stored provider state in this pass.

State:
- Complete; ready to close.

Done:
- Traced the hosted Telegram ingress through web handoff, Cloudflare nudge, hosted run drain, and assistant automation.
- Found the reply failure happens in the provider turn before Telegram delivery because OpenAI rejected a non-`resp_*` previous response id.
- Patched the OpenAI-compatible provider to treat non-`resp*` Responses resume ids as fresh turns, keep fresh-turn context handling, and avoid carrying incompatible generated ids forward.
- Added focused provider option and execution coverage.
- Verified focused provider tests, package-level checks through `pnpm test:diff`, and diff hygiene.
- Fixed the security/privacy review finding by tightening the valid native Responses id gate from `resp*` to `resp_*`, and added coverage for `response-*` ids being dropped.
- Completed required coverage-write and task-finish-review audits with no additional changes.

Now:
- Close the execution plan and create the scoped commit if the shared dirty tree permits it.

Next:
- Hand off verification evidence and residual risk.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: production state may still contain stale non-Responses ids until the next successful assistant turn replaces them.

Working set (files/ids/commands):
- `packages/assistant-engine/src/assistant/providers/openai-compatible.ts`
- `packages/assistant-engine/test/provider-continuity.test.ts`
- `packages/assistant-engine/test/provider-execution.test.ts`
- `pnpm --dir packages/assistant-engine exec vitest run test/provider-continuity.test.ts test/provider-execution.test.ts --config vitest.config.ts --no-coverage` passed.
- `pnpm build:test-runtime:prepared` passed.
- `pnpm test:diff packages/assistant-engine/src/assistant/providers/openai-compatible.ts packages/assistant-engine/test/provider-continuity.test.ts packages/assistant-engine/test/provider-execution.test.ts` passed after prepared-runtime build.
- `security-privacy-review` found the initial `resp*` gate too loose for `response-*` ids; fixed.
- `coverage-write` found no additional test changes needed.
- `task-finish-review` found no issues.
- `agent-docs/exec-plans/active/2026-04-26-hosted-telegram-resume-id.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
Status: completed
Updated: 2026-04-26
Completed: 2026-04-26
