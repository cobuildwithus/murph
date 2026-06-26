Goal (incl. success criteria):
- Enable hosted ChatGPT/Codex account connection from the Settings page.
- Success means the settings route can start a connect attempt for an active hosted member, the runtime can complete the managed Codex account login and report device-code/connected state, and settings renders a usable connection control.

Constraints/Assumptions:
- Preserve the existing hosted-local subscription seed path; local device-code testing may require opting out of the seeded subscription auth.
- Preserve unrelated dirty working-tree changes.
- Do not expose local paths, account identifiers, or secret values in code, docs, logs, or handoff text.

Key decisions:
- Reuse the existing hosted Codex auth attempt store, mailbox wake, runtime control update, and post-checkpoint callback primitives.
- Do not add a separate dev flag; authenticated Settings access and the existing hosted mailbox/runtime path are the feature boundary.

State:
- In progress.

Done:
- Traced the settings route, Codex auth store, runtime wake handler, hosted-local seed auth, and existing tests.
- Confirmed successful `connected` callbacks currently become connection errors and must be fixed.

Now:
- Completed.

Next:
- None.

Open questions (UNCONFIRMED if needed):
- None blocking implementation.

Working set (files/ids/commands):
- apps/web/app/api/settings/chatgpt/route.ts
- apps/web/app/(dashboard)/settings/page.tsx
- apps/web/src/components/settings/hosted-chatgpt-settings.tsx
- apps/web/src/lib/codex-auth/store.ts
- packages/assistant-runtime/src/hosted-runtime/events/codex-auth.ts
- packages/assistant-runtime/src/hosted-runtime/codex-config.ts
- focused Codex auth route/store/runtime tests
Status: completed
Updated: 2026-06-25
Completed: 2026-06-25
