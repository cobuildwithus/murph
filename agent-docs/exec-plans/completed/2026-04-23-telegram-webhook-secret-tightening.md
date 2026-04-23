## Goal

Tighten hosted Telegram webhook authentication by removing the temporary header-less acceptance path, rotating the production webhook secret, and keeping the change scoped to the hosted onboarding Telegram webhook seam plus directly coupled tests.

## Scope

- `apps/web/src/lib/hosted-onboarding/telegram.ts`
- directly coupled Telegram webhook tests under `apps/web/test/**`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`

## Constraints

- Do not print or persist the generated Telegram webhook secret.
- Preserve unrelated dirty-tree edits.
- Keep the runtime contract unchanged aside from requiring the Telegram secret header on webhook requests.

## Verification

- Focused `apps/web` Telegram webhook tests covering valid, missing, and invalid secret handling.

## Notes

- The Telegram webhook URL should be reused from the current Telegram bot webhook config rather than guessed from repo docs or Vercel env values.
- Production setup completed by writing a fresh `TELEGRAM_WEBHOOK_SECRET` to Vercel Production through the sensitive env path and calling Telegram `setWebhook` for `https://www.withmurph.ai/api/hosted-onboarding/telegram/webhook` with `drop_pending_updates=true`.
- Focused verification passed via Telegram route/dispatch Vitest and scoped ESLint. Repo-wide `pnpm typecheck` and the broader `apps/web verify` lane remain blocked by the unrelated pre-existing `packages/core/src/vault.ts(1003,7)` TS2322 error during typecheck/build.
