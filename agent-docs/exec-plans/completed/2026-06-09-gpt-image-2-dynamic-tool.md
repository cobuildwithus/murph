Goal (incl. success criteria):
- Land the supplied GPT Image 2 dynamic-tool patch as a small, maintainable Murph primitive.
- Success means Codex can call one `murph.generate_image` dynamic tool, local runs save generated images under the configured Codex home, hosted runs can upload generated images through the hosted runtime platform, OpenAI Images usage is recorded through the existing assistant usage ledger, and focused tests/typecheck pass.

Constraints/Assumptions:
- Treat the patch as behavioral intent, not overwrite authority.
- Preserve existing dynamic response-media behavior and adjacent active-plan work.
- Keep OpenAI and Cloudflare credentials env-owned; never persist or log raw keys.
- Keep generated-image payloads out of logs and fixtures; tests use synthetic bytes only.
- Prefer direct package-owned seams over new broad managers or ledgers.

Key decisions:
- Use one Codex dynamic tool instead of enabling bundled image skills/plugins.
- Reuse the existing provider-fetch path for hosted OpenAI egress.
- Record image-generation usage as additional provider usage records, not a new ledger.
- Keep hosted upload behind the runtime platform so assistant-engine does not own Cloudflare Images details.

State:
- Implementation, durable docs, completion audits, and audit-driven fixes are integrated in the task worktree; verification is green.

Done:
- Read required repo workflow, architecture, product, security, reliability, verification, and completion docs.
- Inspected the supplied patch and existing nearby image/media plans.
- Added the dynamic image tool, hosted uploader seam, Cloudflare Images effect handler, usage capture, tests, and durable docs.
- Added the GitHub Actions `CLOUDFLARE_IMAGES_API_KEY` secret from local env through CLI stdin without printing the value.
- Ran the required completion audit passes and fixed the accepted findings: abort/drain in-flight dynamic tools on turn failure, serialize dynamic tool execution in request order, convert non-abort image provider errors into structured tool failures, record additionalUsages on notification turns via a shared helper, validate image bytes before upload, preserve usage when media attachment fails, and hash raw image usage JSON.
- Re-ran focused tests, `pnpm typecheck`, and `scripts/workspace-verify.sh test:diff` after the audit-driven fixes; all green.

- Ran a second task-finish-review on the post-fix diff and fixed its accepted findings: serialize only media-mutating dynamic tools (progress updates answer immediately on the bounded progress-delivery drain), resolve credential source per additional usage draft, and return a structured `response media limit reached` tool result when an appended image exceeds the media cap.
- Re-ran `pnpm typecheck`, `scripts/workspace-verify.sh test:diff`, and `git diff --check` after the second fix round; all green.

Now:
- Close this plan with `scripts/finish-task` and open the PR.

Next:
- None.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `packages/assistant-engine/src/assistant-codex.ts`
- `packages/assistant-engine/src/assistant-codex/dynamic-tools.ts`
- `packages/assistant-engine/src/assistant-codex/generate-image-tool.ts`
- `packages/assistant-engine/src/assistant-codex/openai-image-generation.ts`
- `packages/assistant-engine/src/assistant/**`
- `packages/assistant-runtime/src/hosted-runtime/**`
- `packages/hosted-execution/src/assistant-usage.ts`
- `apps/cloudflare/src/runner-egress-intercept.ts`
- `apps/cloudflare/src/runtime-platform/**`
- Focused tests for assistant-engine, hosted-execution, and Cloudflare uploader/egress.
Status: completed
Updated: 2026-06-09
Completed: 2026-06-09
