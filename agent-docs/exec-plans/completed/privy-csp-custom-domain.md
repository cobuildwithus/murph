# Privy CSP Custom Domain Fix

## Goal

Unblock hosted web phone signup in production by ensuring the CSP admits the active custom Privy auth origin used by the browser SDK.

## Scope

- `apps/web/next.config.ts`
- `apps/web/test/next-config.test.ts`
- `apps/web/README.md`

## Constraints

- Keep the fix narrow to hosted web CSP/source resolution.
- Do not weaken CSP beyond the required custom Privy origin.
- Preserve existing explicit env overrides for `PRIVY_CUSTOM_AUTH_DOMAIN` and `PRIVY_BASE_DOMAIN`.

## Plan

1. Confirm how the custom Privy origin is derived today and why production falls back incorrectly.
2. Patch origin resolution so the current hosted public origin shape can derive the custom Privy auth host when explicit env is absent.
3. Add regression coverage for the production `privy.withmurph.ai` case.
4. Run truthful `apps/web` verification for the touched slice.
5. Complete required audits and commit the scoped fix.
Status: completed
Updated: 2026-04-13
Completed: 2026-04-13
