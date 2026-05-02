## Goal

Land the supplied greenfield hosted app-session patch so Murph dashboard/settings auth uses a first-party opaque app session while Privy remains fresh proof for login, linking, and identity-sensitive operations.

## Scope

- `apps/web/prisma/schema.prisma`
- `apps/web/prisma/migrations/**`
- `apps/web/src/lib/hosted-onboarding/**`
- `apps/web/app/api/hosted-onboarding/**`
- `apps/web/app/api/settings/**`
- `apps/web/app/(dashboard)/**`
- `apps/web/app/biomarkers/layout.tsx`
- `apps/web/app/measurement-methods/layout.tsx`
- `apps/web/src/components/{dashboard,settings,ui,experiments}/**`
- Directly coupled hosted-web tests/docs only if required by verification.

## Constraints

- Preserve the target architecture: Murph app session is normal app auth; Privy is fresh proof for login, linking, and security-sensitive identity operations.
- Do not trust expired Privy tokens, add linked-account data to cookies, or introduce a legacy account-adoption endpoint.
- Keep session tokens opaque, random, hashed at rest, HttpOnly, and bounded by a fixed expiry.
- Preserve unrelated active rows and avoid widening beyond hosted app-session/auth fallout.
- Redact personal identifiers from any generated files, logs, and handoff text.

## Verification

- Start with patch application and static inspection.
- Run focused hosted-web checks, then the repo-required verification lane unless blocked by unrelated failures.
- Run required security/privacy, frontend, coverage, and final review audits for this high-risk hosted-web change.

## Outcome

- Applied supplied final app-session hardening patch.
- Moved hosted billing checkout/success routes onto hosted app-session auth while leaving Privy as fresh proof for login/linking.
- Added hosted mutation origin guard to the browser-vault session route before session/workspace reads.
- Added the optional settings identity-link polish so email and Telegram close the dialog and refresh after hosted sync success, matching phone.
- Fixed frontend-review finding so Telegram parent callbacks only fire for manual link sync, not quiet background resync.
- Focused Vitest and diff checks passed; `pnpm test:diff` remains blocked by unrelated hosted-web landing-page expectation drift and an unrelated `HeartbeatButton` design-page prop mismatch.
Status: completed
Updated: 2026-05-03
Completed: 2026-05-03
