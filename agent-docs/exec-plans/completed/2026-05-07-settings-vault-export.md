# Settings Vault Export

## Goal

Make the `/settings` data/privacy export user-useful by downloading the user's browser-vault replica JSON instead of routing the primary UI through the hosted account metadata export.

Success criteria:
- Authenticated users can export the decrypted browser-vault replica from Settings.
- The export includes the same browser-safe vault projection used by dashboard pages.
- The existing account-data route remains available and tested unless intentionally removed later.
- Copy and docs do not imply raw provider tokens, account session secrets, or full backend workspace object keys are exported.

## Constraints

- Preserve unrelated dirty work in the checkout.
- Do not add a broad raw hosted workspace snapshot download surface in this change.
- Treat exported vault data as sensitive health/account data.

## Current Shape

- `HostedDataPrivacySettings` downloads the browser-vault replica through the privacy-specific `/api/settings/vault-export/session` endpoint and asks the loader to surface auth/consent errors instead of collapsing them to empty dashboard state.
- Browser dashboard surfaces keep using `/api/browser-vault/session`, which remains active-access gated.

## Implementation Plan

1. Update Settings export UI flow to load and download the browser-vault replica JSON client-side. Done.
2. Add privacy-specific browser-vault session route so export remains available to authenticated privacy-access users without weakening dashboard access. Done.
3. Update focused tests for the new export behavior and session-route authorization. Done.
4. Update durable docs that describe what the Settings export includes. Done.
5. Run focused verification and required completion audits. In progress.

## Working Set

- `apps/web/src/components/settings/hosted-data-privacy-settings.tsx`
- `apps/web/test/hosted-data-privacy-settings.test.ts`
- `apps/web/src/lib/browser-vault/loader.ts`
- `apps/web/test/browser-vault-loader.test.ts`
- `apps/web/app/api/browser-vault/session/route.ts`
- `apps/web/app/api/settings/vault-export/session/route.ts`
- `apps/web/src/lib/browser-vault/session-handler.ts`
- `apps/web/test/browser-vault-session-route.test.ts`
- `docs/hosted-account-data-deletion-export.md`
- `apps/web/README.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
Status: completed
Updated: 2026-05-07
Completed: 2026-05-07
