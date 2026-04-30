# Hosted Welcome Duplicate Repro

## Goal

Diagnose the hosted Linq/iMessage duplicate welcome after signup without applying a product fix.

## Scope

- Add a focused hosted-local Linq e2e characterization that reproduces the duplicate welcome path.
- Use DB/Cloudflare/Vercel evidence only in redacted aggregate form.
- Do not change production assistant, delivery, mailbox, or onboarding behavior.

## Finding

The hosted activation path creates one signup welcome notification. The first inbound Linq assistant turn then resolves a fresh conversation/session with no visible welcome transcript, so onboarding guidance can ask for the exact welcome again.

## Verification

- `env -u MURPH_DEV_CF_WRANGLER_LOG_LEVEL MURPH_DEV_SKIP_RUNNER_BUNDLE=1 pnpm exec vitest run --config apps/cloudflare/vitest.e2e.config.ts apps/cloudflare/test/hosted-local-linq-first-contact-e2e.test.ts --no-coverage -t "reproduces the duplicate welcome"` passed.
- `pnpm --dir apps/cloudflare typecheck` passed.
