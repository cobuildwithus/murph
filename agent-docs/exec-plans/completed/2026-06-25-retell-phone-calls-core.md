Goal (incl. success criteria):
- Land the supplied Retell phone-calls core patch on an isolated branch/worktree and open a PR.
- Success means the patch applies cleanly against current `main`, preserves hosted trust boundaries, has required durable docs for the new phone-call surface, passes focused/local verification, is committed, pushed, and has a draft PR.

Constraints/Assumptions:
- Treat the supplied patch as behavioral intent, not overwrite authority.
- Keep the implementation minimal and close to existing hosted runtime/web-control patterns.
- Retell credentials and phone-call provider authority stay web-owned; Cloudflare may only reach the signed bounded internal route.
- Preserve unrelated active ledger rows and unrelated worktrees.

Key decisions:
- Use a PR-lane worktree, so local completion-audit subagents are skipped under the patch-implementation exception; the external PR ReviewGPT loop remains required after push.
- Resolve the stale `execution-context.ts` hunk manually against newer generated-image/product-feedback context wiring.
- Store only the bounded call brief and final result in Murph; do not persist raw Retell transcripts.

State:
- Ready to commit and open PR.

Done:
- Created isolated branch/worktree from `origin/main`.
- Applied the supplied patch with one manual conflict resolution.
- Identified and fixed a new test fixture privacy issue.
- Added focused service coverage for hosted phone-call idempotency, member collision, and runtime failure persistence.
- Verification passed:
  - `pnpm --filter @murphai/hosted-execution test`
  - `pnpm typecheck`
  - `pnpm test:diff`
  - `pnpm test:smoke`
  - `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts test/assistant-codex-connected-apps.test.ts --no-coverage`
  - `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts test/phone-calls-service.test.ts --no-coverage`
  - `pnpm test:diff apps/web/src/lib/phone-calls/service.ts apps/web/test/phone-calls-service.test.ts`
  - `git diff --check`

Now:
- Commit with the plan closed.

Next:
- Commit with the plan closed, push, open a draft PR, then run the PR-lane review loop.

Open questions (UNCONFIRMED if needed):
- None currently blocking.

Working set (files/ids/commands):
- packages/hosted-execution/src/phone-calls.ts
- packages/hosted-execution/test/phone-calls.test.ts
- packages/assistant-runtime/src/hosted-runtime/platform.ts
- packages/assistant-runtime/src/hosted-runtime-contracts.ts
- packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts
- packages/assistant-engine/src/assistant/execution-context.ts
- packages/assistant-engine/src/assistant/hosted-tool-context.ts
- packages/assistant-engine/src/assistant/local-service.ts
- packages/assistant-engine/src/assistant/codex-turn/planning.ts
- packages/assistant-engine/src/assistant-codex/dynamic-tools.ts
- packages/assistant-engine/src/assistant-codex/dynamic-tools/phone-calls.ts
- apps/cloudflare/src/runtime-platform/phone-calls-port.ts
- apps/cloudflare/src/runtime-platform/platform-factory.ts
- apps/cloudflare/src/runner-outbound/shared-web-control-policy.ts
- apps/cloudflare/src/runner-outbound/web-control.ts
- apps/cloudflare/test/connected-apps-web-control-policy.test.ts
- apps/web/prisma/schema.prisma
- apps/web/prisma/migrations/20260625000100_hosted_phone_calls/migration.sql
- apps/web/src/lib/phone-calls/**
- apps/web/app/api/internal/phone-calls/route.ts
- agent-docs/phone-calls/**
- ARCHITECTURE.md
- agent-docs/SECURITY.md
- agent-docs/index.md
- agent-docs/references/testing-ci-map.md
- agent-docs/operations/verification-and-runtime.md
Status: completed
Updated: 2026-06-25
Completed: 2026-06-25
