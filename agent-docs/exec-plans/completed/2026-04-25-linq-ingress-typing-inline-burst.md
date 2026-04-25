# Add Linq ingress typing inline burst diagnostic

Status: completed
Created: 2026-04-25
Completed: 2026-04-25

## Goal

- Add a production diagnostic mode that sends the full Linq ingress typing burst inline before Cloudflare handoff.
- Use the mode to prove whether sustained `0/1/3/6s` Linq typing pings make iMessage show typing after idle.

## Scope

- Hosted web Linq webhook diagnostic path only.
- Changed:
  - `apps/web/src/lib/hosted-onboarding/env.ts`
  - `apps/web/src/lib/hosted-onboarding/webhook-service.ts`
  - focused hosted-onboarding tests
  - `apps/web/.env.example`
  - `apps/web/README.md`

## Out of scope

- Changing Cloudflare runner/container behavior.
- Changing assistant reply generation or delivery semantics.
- Adding a new public endpoint.
- Logging raw chat ids, phone numbers, message bodies, payloads, headers, or credentials.

## Result

- Added `HOSTED_LINQ_INGRESS_TYPING_DIAGNOSTIC_BURST_MODE` with default `deferred`.
- `inline` mode awaits every configured typing burst offset before returning to the webhook handoff path.
- Per-attempt timing details now include `burstMode` while still logging only presence/status/attempt metadata.
- Production Vercel env was set to `inline`; a redeploy is required for the runtime to consume it.

## Verification

- `pnpm exec vitest run apps/web/test/hosted-onboarding-env.test.ts apps/web/test/hosted-onboarding-linq-dispatch.test.ts --config apps/web/vitest.config.ts --no-coverage`
- `pnpm --dir apps/web exec tsc -p tsconfig.json --pretty false --noEmit`
- `pnpm --dir apps/web exec eslint src/lib/hosted-onboarding/env.ts src/lib/hosted-onboarding/webhook-service.ts test/hosted-onboarding-env.test.ts test/hosted-onboarding-linq-dispatch.test.ts test/hosted-onboarding-csrf.test.ts test/hosted-onboarding-runtime.test.ts`
- `git diff --check -- apps/web/.env.example apps/web/README.md apps/web/src/lib/hosted-onboarding/env.ts apps/web/src/lib/hosted-onboarding/webhook-service.ts apps/web/test/hosted-onboarding-env.test.ts apps/web/test/hosted-onboarding-linq-dispatch.test.ts apps/web/test/hosted-onboarding-csrf.test.ts apps/web/test/hosted-onboarding-runtime.test.ts`
- `bash scripts/workspace-verify.sh test:diff apps/web/src/lib/hosted-onboarding/env.ts apps/web/src/lib/hosted-onboarding/webhook-service.ts apps/web/test/hosted-onboarding-env.test.ts apps/web/test/hosted-onboarding-linq-dispatch.test.ts apps/web/test/hosted-onboarding-csrf.test.ts apps/web/test/hosted-onboarding-runtime.test.ts apps/web/.env.example apps/web/README.md`

## Audits

- Security/privacy review: no findings.
- Coverage-write review: no edits needed.
- Task-finish review: found one `.env.example` comment mismatch; fixed and reran focused verification.
