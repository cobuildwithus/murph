Goal (incl. success criteria):
- Make `computer_pause_for_user` a state-only pause primitive for hosted computer runs.
- The tool must not send a user-visible message or require model-authored message text.
- The tool result should return structured pause facts, including the browser handoff URL when one is created, so Murph's normal final response is the only user-visible delivery path.

Constraints/Assumptions:
- Keep `finish_without_reply` unchanged except after a successful same-turn computer pause, where a final response is required because pause no longer sends separately.
- Keep Kernel live-view URLs hidden; only the member-gated hosted handoff URL may be returned.
- Preserve same-turn computer tool locking after a pause.
- Preserve explicit resume checks for a later mailbox item and matching delivery context.
- Avoid unrelated dirty handoff UI/runtime files already present in the checkout.

Key decisions:
- Delete the pause tool's `message` input instead of replacing it with another prompt-authored handoff string.
- Remove assistant-engine's `sendRequiredUserMessage` call for computer pause.
- Keep `final_confirmation` as a pause reason, not as a separate delivery primitive.
- Accept and ignore legacy pause request `message` fields for deploy skew and old resumed model context, while keeping the advertised tool schema message-free.

State:
- Active.

Done:
- Reviewed current pause call path and tests.
- Removed the pause tool `message` input and side-channel required user-message delivery.
- Returned structured pause payloads with hosted `handoffUrl` when present.
- Updated web pause persistence to store no new authored awaiting message.
- Rejected `finish_without_reply` after a successful computer pause so the final response must carry the handoff URL or next step.
- Added resumed Codex transport fallback before side effects so a dead resumed stream can start one fresh thread instead of leaving Telegram typing with no outbox reply.
- Added hosted runtime URL redaction for persisted diagnostics.
- Updated focused assistant-engine, hosted-execution, web computer-use, Cloudflare outbound, prompt, and security-doc coverage.
- Added a transport-only compatibility tolerance that accepts and strips legacy pause `message` in the signed internal request parser; the model-facing tool schema still does not expose `message`.
- Verification passed:
  - `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-codex-computer-tools.test.ts test/assistant-codex-runtime.test.ts test/model-behavior.test.ts` (218 tests)
  - `pnpm --dir packages/hosted-execution exec vitest run --config vitest.config.ts --no-coverage test/hosted-execution.test.ts`
  - `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-execution-computer-use.test.ts`
  - `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/runner-outbound.test.ts`
  - `pnpm typecheck`
- `scripts/workspace-verify.sh test:diff ...` reached broad owner tests and failed on an unrelated CLI hosted bridge timeout; rerunning that exact CLI test alone passed.
- Security review found no medium-or-higher security issues.
- Deep review found mixed-version deploy risk; addressed the web-first side by stripping legacy transport `message`. Old web still requires a tandem/web-first rollout if new runners deploy separately.

Now:
- Prepare scoped commit without unrelated dirty work.

Next:
- Commit scoped changes if unrelated dirty work does not block a safe scoped commit.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `packages/assistant-engine/src/assistant-codex/dynamic-tools.ts`
- `packages/assistant-engine/src/assistant-codex.ts`
- `packages/assistant-engine/src/assistant/system-prompt.ts`
- `packages/assistant-engine/skills/computer-use/SKILL.md`
- `packages/hosted-execution/src/computer-use.ts`
- `packages/hosted-execution/test/hosted-execution.test.ts`
- `apps/web/src/lib/computer-use/service.ts`
- `apps/web/src/lib/computer-use/store.ts`
- `apps/web/app/api/internal/computer/runs/[runId]/pause-for-user/route.ts`
- `apps/web/test/hosted-execution-computer-use.test.ts`
- `apps/cloudflare/test/runner-outbound.test.ts`
- focused assistant-engine, hosted-execution, web, and Cloudflare tests
Status: completed
Updated: 2026-06-22
Completed: 2026-06-22
