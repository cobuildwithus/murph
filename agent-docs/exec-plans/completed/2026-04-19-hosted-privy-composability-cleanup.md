## Goal

Split the hosted Privy auth path into cleaner internal seams so token parsing and verified-user session shaping stop living inside `privy.ts`, while preserving the current token-first member lookup and DB fallback behavior.

## Scope

- `apps/web/src/lib/hosted-onboarding/privy.ts`
- `apps/web/src/lib/hosted-onboarding/hosted-session.ts`
- new internal hosted-onboarding Privy helper modules if needed
- focused hosted Privy/session tests in `apps/web/test/**`

## Constraints

- Do not change the current trust model: token member id stays a fast path, DB fallback stays in place.
- Keep the read path on direct identity-token verification; do not reintroduce user fetches.
- Prefer tighter ownership and smaller helper surfaces over compatibility wrappers.
- Preserve unrelated in-flight work elsewhere in `apps/web`, `apps/cloudflare`, and shared packages.

## Verification

- `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts hosted-onboarding-privy.test.ts hosted-session.test.ts`
- `pnpm --dir apps/web typecheck`
- required audit passes per repo workflow if code changes land

## Notes

- Good cleanup here means fewer mixed responsibilities, less duplicated Privy session shaping logic, and less dead or purely test-driven surface area.
Status: completed
Updated: 2026-04-19
Completed: 2026-04-19
