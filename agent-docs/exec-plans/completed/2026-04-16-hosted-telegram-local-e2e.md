## Goal

Add a local hosted Cloudflare E2E that exercises the Telegram inbound-to-reply path on the existing dev harness, including Telegram typing/send side effects.

## Scope

- `apps/cloudflare/test/hosted-local-telegram-first-contact-e2e.test.ts`
- `apps/cloudflare/package.json`
- any narrow helper reuse needed inside existing `apps/cloudflare/test/**` E2E scaffolding
- `scripts/dev-hosted-local/*` only as needed to keep the local hosted harness bootable for the Telegram lane

## Constraints

- Keep the change scoped to local hosted E2E coverage; do not alter production runtime behavior.
- Reuse the existing hosted local harness and stub external Telegram API calls locally.
- Preserve the existing Linq and duplicate-commit E2E paths.

## Verification

- Focused Cloudflare local E2E run for the new Telegram scenario
- Existing duplicate-commit local E2E rerun to confirm the harness still covers the stale-finalize recovery class
- Focused local-dev script tests plus Cloudflare typecheck/build when harness boot changes are required
Status: completed
Updated: 2026-04-16
Completed: 2026-04-16
