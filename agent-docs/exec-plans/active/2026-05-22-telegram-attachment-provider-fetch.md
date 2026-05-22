# Hosted Telegram Attachment Provider Fetch

## Goal

Harden hosted Telegram attachment downloads so every hosted fallback path uses the injected provider fetch seam instead of ambient process fetch, while preserving Worker-owned provider credential injection.

## Evidence

- Linq attachment downloads already failed in production when an ambient fetch bypassed Cloudflare's hosted provider egress wrapper.
- Static audit found Telegram attachment fallback code still owns ambient `globalThis.fetch` calls.
- Normal production Telegram import currently prefers the effects-port path, but the fallback should remain safe if effects-port wiring changes or is unavailable.

## Scope

- `packages/assistant-runtime/src/hosted-runtime/events/telegram.ts`
- `packages/assistant-runtime/src/hosted-runtime/events/conversation.ts`
- `packages/assistant-runtime/src/hosted-provider-effects.ts`
- `apps/cloudflare/src/runner-egress-intercept.ts`
- Focused tests for assistant-runtime and Cloudflare egress.

## Verification

- Focused Telegram attachment and runner egress tests.
- `pnpm test:diff` on touched files.
- `pnpm typecheck`.
- Required coverage, security/privacy, and finish reviews for hosted provider egress changes.
