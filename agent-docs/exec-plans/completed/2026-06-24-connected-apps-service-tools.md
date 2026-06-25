Goal (incl. success criteria):
- Land the supplied connected-apps Composio patch on a dedicated branch/worktree and open a PR.
- Expand supported connected-app toolkits plus server-approved built-in service tools without broadening account-connected execution authority.
- Preserve explicit account selection for connected-account tools while allowing accountless execution only for allowlisted built-in service tool slugs.
- Add the second supplied calendar-event patch as a confirmed-write exception without turning connected apps into a general write surface.

Constraints/Assumptions:
- Keep the implementation simple and owner-local; avoid compatibility shims or speculative provider adapters.
- Composio API key, Tool Router session ids, OAuth state, provider tokens, account data, and provider payloads must stay web-owned and out of runner prompts/logs.
- Built-in services must be configured through the server-owned session policy, not through user-controlled toolkit env.
- Calendar writes must require `userConfirmed: true`, an owned selected account, an allowlisted create-event slug, forced primary-calendar/no-meeting-link options, and rejection of unsupported arguments before provider execution.
- PR-lane worktree path uses the repo workflow skip for local audit subagents; ReviewGPT loop remains required after push.

Key decisions:
- Treat this as high-risk PR-lane work because it touches connected-app trust boundaries, external egress, shared schema, and assistant dynamic-tool descriptions.
- Use focused tests for connected-app service behavior plus `pnpm typecheck`; run broader lanes if focused proof exposes a cross-owner gap.
- Keep normal connected-app execution on the read-only Tool Router session; use direct Composio tool execution only for the two confirmed calendar-create slugs.

State:
- Implementation and verification complete; preparing scoped commit, push, PR, and ReviewGPT.

Done:
- Read repo routing, architecture, security, reliability, completion, verification, and testing docs.
- Created isolated branch/worktree.
- Ported the first patch intent manually against current `origin/main`.
- Verified first-patch focused tests, package suites, `pnpm typecheck`, and `pnpm test:diff` before the second patch arrived.
- Ported the second calendar-event patch as a confirmed direct-write exception with tests.
- Ran focused connected-app web tests, hosted-execution package tests, assistant-engine package tests, `pnpm typecheck`, `pnpm docs:drift`, and `pnpm test:diff`.

Now:
- Run final diff/privacy checks and commit.

Next:
- Commit with `scripts/finish-task`, push, open PR, and start ReviewGPT.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED whether Composio supports every listed built-in service slug and calendar-create slug in the active Murph Composio workspace; code should fail closed through the server-owned Composio API response if not configured upstream.

Working set (files/ids/commands):
- Branch: `codex/connected-apps-service-tools`
- Patch sources: two local Downloads patches supplied by user
- Composio docs checked: Tool Router session `tools`, Tool Router execute `account`, direct tool execute `connected_account_id`/`version`, Composio Search toolkit slugs, Instacart no-auth/tool list, Google Calendar and Outlook toolkit versions/create-event slugs.
- Files expected: `.env.example`, `ARCHITECTURE.md`, `agent-docs/SECURITY.md`, `agent-docs/index.md`, `apps/web/src/lib/connected-apps/**`, `apps/web/test/connected-apps-*.test.ts`, `packages/hosted-execution/src/connected-apps.ts`, `packages/hosted-execution/test/connected-apps.test.ts`, `packages/assistant-engine/src/assistant/system-prompt.ts`, `packages/assistant-engine/src/assistant-codex/dynamic-tools/connected-apps.ts`, `packages/assistant-engine/test/assistant-codex-connected-apps.test.ts`
Status: completed
Updated: 2026-06-24
Completed: 2026-06-24
