# Add homepage email auth alongside Telegram on hosted signup

Status: completed
Created: 2026-04-14
Updated: 2026-04-14

## Goal

- Add Privy email OTP login to the homepage signup section as an inline option beside Telegram while reusing the existing hosted onboarding completion flow.

## Success criteria

- Homepage signup shows compact inline Telegram and Email auth options beneath the SMS flow.
- Email auth uses Privy's email OTP login and reuses the hosted post-auth completion and redirect path instead of duplicating onboarding finalization logic.
- Telegram copy is shortened to fit the inline layout cleanly.
- Focused `apps/web` tests cover homepage rendering plus email/Telegram completion behavior.
- Required verification and completion-workflow audits pass, or any unrelated blocker is documented.

## Scope

- In scope:
- `apps/web/src/components/homepage/**`
- Reusable hosted onboarding helpers needed for homepage email auth
- Matching `apps/web/test/**` coverage for the touched flow
- `agent-docs/exec-plans/active/**`
- Out of scope:
- Settings email-management flows for already-authenticated users
- Server-side onboarding contract changes
- Non-homepage auth UX redesigns beyond the requested inline option row

## Constraints

- Technical constraints:
- Reuse existing hosted Privy completion, wallet readiness, and redirect logic where possible.
- Prefer extending existing shared helpers over creating separate email-only onboarding architecture.
- Keep the diff narrowly inside `apps/web` plus the plan/ledger artifacts.
- Product/process constraints:
- Preserve the existing phone-first signup flow.
- Do not revert or interfere with unrelated worktree edits.

## Risks and mitigations

1. Risk: duplicating post-auth completion logic across Telegram and Email buttons.
   Mitigation: extract a shared homepage post-auth completion helper and route both buttons through it.
2. Risk: email OTP UI drifts away from the established phone verification flow.
   Mitigation: reuse existing verification components/helpers where practical and keep email-specific state limited to the OTP entry differences.
3. Risk: homepage copy/layout regresses while adding another option.
   Mitigation: update the homepage render test alongside the client flow tests.

## Tasks

1. Inspect the existing homepage auth panel, Telegram button, and hosted phone/email helpers to identify the minimum shared seam.
2. Implement homepage email auth with Privy email OTP and shared hosted completion/redirect handling.
3. Tighten the inline auth copy/layout for Telegram and Email.
4. Update focused homepage/auth tests.
5. Run scoped `apps/web` verification, required audit passes, and commit only the touched paths.

## Decisions

- Reuse the existing hosted completion endpoint and wallet readiness flow rather than creating a separate email onboarding backend path.
- Keep homepage alternate auth methods inline and compact, with the phone flow remaining the primary form.

## Verification

- Commands to run:
- `pnpm --dir apps/web test -- apps/web/test/page.test.ts apps/web/test/homepage-telegram-auth-button.test.tsx apps/web/test/homepage-email-auth-button.test.tsx`
- `pnpm test:diff apps/web`
- `pnpm --dir apps/web verify`
- Required completion-workflow audit passes: `coverage-write` and `task-finish-review`
- Expected outcomes:
- Homepage auth rendering and the new email completion flow are covered by focused tests.
- Scoped hosted-web verification passes without touching unrelated worktree changes.
Completed: 2026-04-14
