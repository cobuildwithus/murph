Goal (incl. success criteria):
- Keep hosted Codex auto-reply turns under the per-message cost target during normal resumed-thread use.
- Use the existing Codex auto-compaction primitive instead of adding custom orchestration or token-accounting infrastructure.
- Prevent large inbound images and generated CLI catalogs from becoming always-on hosted Codex context.
- Prove hosted local usage rows stay within the per-message input-token and cost budgets.

Constraints/Assumptions:
- Do not expose contact identifiers, local paths, raw messages, raw health data, or secrets in docs, logs, tests, or commits.
- Current evidence showed high-cost turns had zero tool calls and were driven by oversized resumed Codex history.
- Prompt cache is helpful but not an invariant; cold starts can lose most cached input.
- Follow-up E2E evidence showed large image attachments could enter native Codex history, and the first hosted turn still carried a generated CLI catalog in developer instructions.

Key decisions:
- Lower the hosted Codex auto-compaction threshold to a conservative reply-cost budget instead of adding a second compaction layer.
- Keep the limit in the generated Codex config so Cloudflare and local hosted runs share the same behavior.
- Treat ordinary image attachments as text/metadata evidence unless they fit a small native-image budget.
- Hosted Codex turns should discover exact CLI command details on demand instead of embedding the generated CLI catalog in every bootstrap prompt.
- Guard hosted native resume by rollout size and clear persisted resume state after over-budget hosted auto-reply usage.

State:
- Completed.

Done:
- Identified that the latest high-cost turn had zero command/MCP/web/file tool calls.
- Identified the resumed Codex thread as the high-token source.
- Lowered hosted Codex auto-compaction to 12k input tokens.
- Added hosted resume-budget inspection and over-budget resume clearing.
- Capped native image routing/evidence budgets and redacted image file metadata from prompts.
- Omitted the generated CLI catalog from hosted bootstrap developer instructions.
- Added hosted-local E2E assertions for both input-token and per-turn cost budgets.
- Converted browser-vault refresh nudges away from hosted mailbox appends and coalesced duplicate pending background/control signals.
- Added bounded runner-health response diagnostics for failed container startup checks.

Verification:
- Live local iMessage smoke reply completed; latest checked turn cost was below 10 cents and had no tool-output blowup.
- `pnpm typecheck`
- `git diff --check`
- `bash scripts/workspace-verify.sh test:diff $(git diff --name-only)`
- `pnpm hosted-local e2e linq-webhook`
- `pnpm hosted-local e2e --no-bundle`

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `packages/assistant-runtime/src/hosted-runtime/codex-config.ts`
- `packages/assistant-engine/src/assistant/codex-resume-budget.ts`
- `packages/assistant-engine/src/assistant/codex-turn/planning.ts`
- `packages/assistant-engine/src/assistant/turn-finalizer.ts`
- `packages/assistant-engine/src/assistant/attachment-evidence-model.ts`
- `packages/assistant-engine/src/assistant/automation/prompt-builder.ts`
- `packages/assistant-engine/src/inbox-multimodal.ts`
- `packages/assistant-engine/src/inbox-routing-vision.ts`
- `apps/cloudflare/test/hosted-local-codex-long-thread-e2e.test.ts`
- `apps/web/src/lib/hosted-orchestration/signal-runtime.ts`
