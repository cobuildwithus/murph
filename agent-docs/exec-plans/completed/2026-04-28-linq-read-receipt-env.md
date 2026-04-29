Goal (incl. success criteria):
- Fix hosted Linq read receipts so inbound Linq conversation messages call the mark-read API with the configured Linq outbound env in production.
- Success means the runtime uses the forwarded Linq API env instead of platform-only env, focused tests catch the env split, and scoped verification passes or any unrelated blockers are named.

Constraints/Assumptions:
- Preserve unrelated dirty work and active hosted-runtime/share-pack lanes.
- Do not print secrets or raw credentials.
- The mark-read provider acknowledgement remains best-effort; local inbox import remains authoritative.

Key decisions:
- Keep the fix inside hosted conversation ingestion/channel activity rather than changing global env policy.

State:
- Implemented; required verification and audit passes are green. Scoped commit is blocked by overlapping unrelated dirty edits in the same files.

Done:
- Root cause identified: `markHostedConversationReadBestEffort` receives `runtime.platformEnv`, but Linq API config is in forwarded env.
- Consolidation direction chosen: keep this inside hosted-runtime with shared channel env builders; do not widen assistant-engine read-receipt contracts.
- Implemented `channel-activity.ts` as the shared hosted channel activity surface for Linq typing/read and Telegram channel env construction.
- Tightened Linq env to `LINQ_API_BASE_URL`/`LINQ_API_TOKEN` with source-bound token/base URL selection.
- Tightened Telegram typing, attachment download, and delivery to Telegram-only env keys.
- Required coverage-write, security/privacy, and task-finish reviews completed with no remaining findings.

Now:
- Close the execution plan because a safe scoped commit is blocked by overlapping unrelated dirty edits.

Next:
- Hand off with verification results and commit blocker.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED whether prod Cloudflare runner was redeployed with commit `3d06d7a7f`; the code bug is present regardless.

Working set (files/ids/commands):
- `packages/assistant-runtime/src/hosted-runtime/events/conversation.ts`
- `packages/assistant-runtime/src/hosted-runtime/channel-activity.ts`
- `packages/assistant-runtime/test/hosted-runtime-conversation-event.test.ts`
- `packages/operator-config/src/linq-runtime.ts` and focused tests only if needed
- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts test/hosted-runtime-channel-activity.test.ts test/hosted-runtime-conversation-event.test.ts test/hosted-runtime-workspace-assistant-phase.test.ts --no-coverage` passed.
- `pnpm --dir packages/assistant-runtime typecheck` passed.
- `pnpm typecheck` passed.
- `pnpm --dir packages/assistant-runtime test:coverage` passed.
- `git diff --check` over touched assistant-runtime files passed.
Status: completed
Updated: 2026-04-28
Completed: 2026-04-28
