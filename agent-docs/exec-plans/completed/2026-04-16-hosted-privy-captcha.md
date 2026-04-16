## Goal (incl. success criteria)

Enable Privy's supported invisible CAPTCHA path for the hosted onboarding login flows so the hand-rolled phone/email/telegram auth UI benefits from dashboard-configured bot mitigation without introducing duplicate CAPTCHA instances.

## Constraints / Assumptions

- Follow Privy's documented custom-login CAPTCHA integration.
- Keep the existing hosted auth UX intact aside from the hidden CAPTCHA mount.
- Only one Privy `<Captcha />` instance should be rendered per surface at a time.
- Do not add new npm packages.

## Key decisions

- Mount a shared Privy `Captcha` component once at the top-level hosted auth surfaces.
- Reuse the existing CSP allowances for Cloudflare Turnstile rather than changing security headers unless the docs/runtime prove it is necessary.

## State

- in_progress

## Done

- Verified Privy docs for CAPTCHA on custom login flows and bot traffic mitigation.
- Verified the installed `@privy-io/react-auth` SDK already exports `Captcha`.
- Verified hosted-web CSP already includes `https://challenges.cloudflare.com`.

## Now

- Wire a single shared `Captcha` into hosted auth panel / standalone phone / invite phone surfaces.
- Update focused tests to mock and assert the CAPTCHA mount.

## Next

- Run focused auth tests and workspace typecheck.
- Commit the scoped hosted onboarding follow-up.

## Open questions

- None.

## Working set (files / ids / commands)

- `apps/web/src/components/hosted-onboarding/hosted-auth-panel.tsx`
- `apps/web/src/components/hosted-onboarding/hosted-phone-auth.tsx`
- `apps/web/src/components/hosted-onboarding/hosted-invite-phone-auth.tsx`
- `apps/web/src/components/hosted-onboarding/hosted-privy-captcha.tsx`
- `apps/web/test/hosted-auth-panel.test.tsx`
- `apps/web/test/hosted-phone-auth.test.ts`
- `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-auth-panel.test.tsx apps/web/test/hosted-phone-auth.test.ts`
- `pnpm typecheck`
Status: completed
Updated: 2026-04-16
Completed: 2026-04-16
