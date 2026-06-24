Goal (incl. success criteria):
- Remove the disabled hosted ChatGPT settings UI after rebasing PR #263 onto current `main`.
- The settings page should not render a dead ChatGPT connect card while hosted credential isolation is unavailable.

Constraints/Assumptions:
- Keep backend cleanup/control paths fail-closed for deploy skew and old queued callbacks.
- Preserve current `main` settings page structure, including passkey and wearable rows.

Key decisions:
- Delete the unused `HostedChatGptSettings` component and its tests.
- Keep the fail-closed `/api/settings/chatgpt` route and internal callback route for cleanup/control compatibility.

State:
- Complete.

Done:
- Resolved settings-page rebase conflict by keeping current `main` structure without the ChatGPT card.
- Removed the dead component and stale settings-page mock.
- Focused web/runtime tests and full typecheck passed.
- Docs drift, diff check, and redaction scan passed.

Now:
- Ready to commit and push.

Next:
- Push the rebased branch and rerun ReviewGPT.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `apps/web/app/(dashboard)/settings/page.tsx`
- `apps/web/src/components/settings/hosted-chatgpt-settings.tsx`
- `apps/web/test/hosted-chatgpt-settings.test.tsx`
- `apps/web/test/settings-page.test.ts`
Status: completed
Updated: 2026-06-23
Completed: 2026-06-23
