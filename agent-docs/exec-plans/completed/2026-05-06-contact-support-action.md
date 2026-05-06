Goal (incl. success criteria):
- Add a reusable hosted-web contact support component that opens an email to support@withmurph.ai.
- Use it on the Telegram conflict/error flow and invite blocked state.
- Add focused coverage and design-system visibility for the new shared component.

Constraints/Assumptions:
- Preserve unrelated dirty work in the checkout.
- Do not include personal identifiers in code, tests, docs, logs, or mailto bodies.
- Keep the UI aligned with Murph warm-paper design patterns.

Key decisions:
- Use a mailto anchor so the click opens the user's email client without storing support request state.
- Keep mailto subject/body generic and context-oriented only.

State:
- Complete.

Done:
- Read repo routing, frontend, verification, product, and design docs.
- Added reusable support mailto action.
- Wired support action into invite blocked, Telegram setup, and dashboard Telegram card support-error surfaces.
- Added focused tests for helper mailto encoding, invite blocked state, Telegram setup support error, and settings-card support error.
- Ran focused tests and lint.
- Ran required security/privacy, frontend, coverage, and final review passes; fixed findings.

Now:
- Completed.

Next:
- None.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `apps/web/src/components/support/contact-support-action.tsx`
- `apps/web/src/components/settings/hosted-telegram-settings.tsx`
- `apps/web/src/components/settings/hosted-telegram-card-settings.tsx`
- `apps/web/src/components/hosted-onboarding/join-invite-stage-server.tsx`
- `apps/web/app/design/components-content.tsx`
- `pnpm --dir apps/web exec vitest run test/contact-support-action.test.ts test/settings-telegram-settings.test.ts test/join-invite-page-view.test.ts --config vitest.workspace.ts --no-coverage` passed after final fixes.
- `pnpm --dir apps/web lint` passed after final fixes.
- Earlier `bash scripts/workspace-verify.sh test:diff ...` and `pnpm typecheck` passed before unrelated workspace drift.
- Later reruns were blocked by unrelated untracked `apps/web/src/lib/hosted-onboarding/billing-plan-change-service.ts` type errors.
Status: completed
Updated: 2026-05-06
Completed: 2026-05-06
