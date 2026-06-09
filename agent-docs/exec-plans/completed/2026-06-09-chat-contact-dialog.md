# Sidebar Chat-With-Murph Contact Dialog

## Goal

When a member has two or more connected contact channels (text, Telegram, email), the sidebar "Chat with Murph" button opens a picker dialog instead of silently routing to the priority channel. With exactly one channel the button keeps opening that channel directly. With zero channels the existing settings/auth gates stay unchanged.

Additionally, the email contact option must target the member's signed reply alias (`murph+<token>@mail.withmurph.ai`) instead of the public `murph@mail.withmurph.ai` address, because direct public-address ingress is dropped by hosted email routing (no authorized ingress route for unauthenticated public senders).

Success criteria:

- 0 channels: unchanged auth/settings gates.
- 1 channel: unchanged direct anchor behavior.
- 2+ channels: dialog listing each connected channel as a direct link.
- Email options built from the contact context use the member reply alias when available.
- No new persisted state, API routes, or server surface.

## Scope

- `apps/web/src/lib/murph-contact-routing.ts`
- `apps/web/src/lib/hosted-onboarding/hosted-contact-context.ts`
- `apps/web/src/components/murph/hosted-murph-contact-action.tsx`
- `apps/web/src/components/dashboard/sidebar-chat-action.tsx`
- `apps/web/src/components/dashboard/sidebar-chat-contact-dialog.tsx` (new)
- `apps/web/test/murph-contact-routing.test.ts` (new)
- `apps/web/test/sidebar-chat-action.test.tsx`
- `apps/web/test/sidebar-chat-contact-dialog.test.tsx` (new)
- `apps/web/test/upload-labs-action.test.tsx`
- `apps/web/test/experiment-detail-client-contract.test.tsx`

## Constraints

- Reuse the existing dialog pattern from `sidebar-chat-auth-gate.tsx`; no new UI primitives.
- Keep existing single-option hosted contact surfaces outside the sidebar unchanged in behavior.
- Other `MURPH_CONTACT_EMAIL` call sites (connect page, experiments, welcome email) are out of scope.

## Verification Plan

- `pnpm --dir apps/web typecheck`
- Focused vitest run for `apps/web/test/sidebar-chat-action.test.tsx` (plus any touched routing test)
- Browser readback of the sidebar button states where feasible; otherwise record the visual-verification gap for frontend review.
- Required audits: `security-privacy-review`, `frontend-review`, `coverage-write`, `task-finish-review`.
Status: completed
Updated: 2026-06-09
Completed: 2026-06-09
