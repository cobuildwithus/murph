Goal (incl. success criteria):
- Add a Telegram "Message Murph" action on `/settings` when Telegram is linked.
- Add copy support for the Murph Telegram username in the sidebar Chat with Murph dialog.
- Make the Gmail action visually connected under the email contact row, with square top corners and matching bottom radius.
- Success means the settings and sidebar contact surfaces expose the requested actions, keep existing email/phone behaviors, and pass focused UI checks.

Constraints/Assumptions:
- Keep the change scoped to hosted web contact UI.
- Use the existing Murph Telegram bot link and username constants where available.
- Preserve unrelated working-tree edits.

Key decisions:
- Use direct Telegram bot URL navigation for "Message Murph", matching the sidebar contact action target.
- Keep the Gmail action as a real button/link row attached to the email option rather than an inline text affordance.

State:
- Complete.

Done:
- Loaded frontend, product, design, verification, and completion workflow guidance.
- Added settings Telegram "Message Murph" actions for connected Telegram accounts.
- Added Telegram username copy support to shared Murph contact options and the sidebar dialog.
- Changed sidebar webmail shortcuts into attached button rows under email options.
- Fixed inset focus rings after frontend-review found clipped focus risk.
- Added focused tests for settings Telegram action visibility, Telegram copy value/click behavior, and the attached Gmail row.
- Ran required frontend-review and coverage-write audits.
- Verification passed:
  - `pnpm -C apps/web test:prepared -- apps/web/test/sidebar-chat-contact-dialog.test.tsx`
  - `pnpm test:diff apps/web/src/lib/murph-contact-routing.ts apps/web/src/components/settings/hosted-account-settings-cards.tsx apps/web/src/components/settings/hosted-telegram-card-settings.tsx apps/web/src/components/settings/hosted-telegram-settings-sections.tsx apps/web/src/components/dashboard/sidebar-chat-contact-dialog.tsx apps/web/test/murph-contact-routing.test.ts apps/web/test/sidebar-chat-contact-dialog.test.tsx apps/web/test/settings-telegram-settings.test.ts apps/web/test/hosted-account-settings-cards.test.tsx`
  - temporary Playwright layout checks at 1024px and 390px against compiled app CSS.

Now:
- Ready for scoped commit.

Next:
- Commit scoped changes with `scripts/finish-task`.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- apps/web/src/components/settings/hosted-telegram-card-settings.tsx
- apps/web/src/components/dashboard/sidebar-chat-contact-dialog.tsx
- apps/web/src/lib/murph-contact-routing.ts
- apps/web/test/settings-telegram-settings.test.ts
- apps/web/test/sidebar-chat-contact-dialog.test.tsx
- apps/web/test/murph-contact-routing.test.ts
Status: completed
Updated: 2026-06-15
Completed: 2026-06-15
