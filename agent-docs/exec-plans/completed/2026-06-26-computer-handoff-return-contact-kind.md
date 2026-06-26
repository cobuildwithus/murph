Goal (incl. success criteria):
- Preserve the native return channel for hosted computer-use handoffs so completed text and Telegram handoffs resume in their original channel while email-origin handoffs instruct the user to reply in the existing email thread.
- Success means the return contact kind is derived from the hosted message channel, persisted on the handoff, preserved across refresh/fallback paths, used by `/done`, rendered in terminal handoff UI, and covered by focused tests.

Constraints/Assumptions:
- Keep the change in the existing computer-use handoff and hosted delivery context primitives; do not add a new contact routing service or recovery surface.
- The field is nullable for compatibility with old handoffs and old hosted runners.
- Deploy web/migration before any runner bundle that sends the new delivery-context field.
- Preserve unrelated active ledger rows and working-tree changes.

Key decisions:
- Store a small enum-like `returnContactKind` on `HostedComputerHandoff`.
- Map Linq-origin messages to `text`, Telegram to `telegram`, email to `email`, and unknown channels to `null`.
- Keep email completion on the web handoff page with explicit reply-in-thread instructions instead of sending a new contact-option prompt.

State:
- Implementation verified locally; ready for scoped commit and PR.

Done:
- Reviewed the supplied patch and repo workflow requirements.
- Created an isolated branch/worktree for the PR lane.
- Added nullable computer handoff return-contact persistence, native `/done` routing, email terminal UI, compact saving status, and focused coverage.
- Updated stale ReviewGPT release-smoke prompt assertions exposed by `test:diff`.
- Verification passed: `pnpm --dir apps/web prisma:generate`; focused web and assistant-engine tests; `pnpm --dir packages/cli test -- release-script-coverage-audit.test.ts`; `pnpm --dir apps/web lint`; `pnpm build`; `pnpm typecheck`; `pnpm test:diff`; `git diff --check`.

Now:
- Commit the scoped diff and rebase onto current `origin/main`.

Next:
- Push, open the PR, and complete the ReviewGPT loop.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- packages/hosted-execution/src/computer-use.ts
- packages/assistant-engine/src/assistant/hosted-tool-context.ts
- apps/web/prisma/schema.prisma
- apps/web/prisma/migrations/*computer_handoff_return_contact_kind*
- apps/web/src/lib/computer-use/store.ts
- apps/web/src/lib/computer-use/service.ts
- apps/web/app/api/computer/handoff/[token]/done/route.ts
- apps/web/app/computer/handoff/[token]/page.tsx
- apps/web/src/components/computer-use/computer-handoff-active-view.tsx
- apps/web/test/computer-handoff-route-page.test.tsx
- apps/web/test/hosted-computer-managed-auth.test.ts
- apps/web/test/hosted-execution-computer-use.test.ts
- packages/assistant-engine/test/assistant-codex-computer-tools.test.ts
Status: completed
Updated: 2026-06-25
Completed: 2026-06-25
