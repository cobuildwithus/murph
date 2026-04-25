# Add Linq ingress typing burst diagnostic

Status: completed
Created: 2026-04-25
Updated: 2026-04-25

## Goal

- Extend the gated Vercel-side Linq ingress typing diagnostic so a cold iMessage test can send one immediate typing ping and a short configurable sequence of post-response refresh pings.
- Use this to distinguish "typing request arrives too late" from "Linq accepts typing but iMessage does not display it after idle."

## Scope

- Hosted web Linq webhook diagnostic path only.
- Changed files:
  - `apps/web/src/lib/hosted-onboarding/env.ts`
  - `apps/web/src/lib/hosted-onboarding/webhook-service.ts`
  - focused hosted-onboarding tests
  - `apps/web/.env.example`
  - `apps/web/README.md`

## Out of scope

- Changing hosted run execution semantics.
- Changing Cloudflare runner/container typing ownership.
- Adding a new public manual typing endpoint.
- Logging raw chat ids, phone numbers, message bodies, or credentials.

## Constraints

- Keep the diagnostic gated by `HOSTED_LINQ_INGRESS_TYPING_DIAGNOSTIC`.
- The webhook should still return promptly; only the first ping may run inline before the hosted execution handoff.
- Deferred refresh pings must not depend on the request abort signal after the response is scheduled.
- Logs must remain privacy-minimal and contain only booleans, attempt indexes, timings, statuses, and response reasons.

## Verification

- `pnpm exec vitest run apps/web/test/hosted-onboarding-env.test.ts apps/web/test/hosted-onboarding-linq-dispatch.test.ts --config apps/web/vitest.config.ts --no-coverage`
- `pnpm --dir apps/web exec tsc -p tsconfig.json --pretty false --noEmit`
- `pnpm --dir apps/web exec eslint src/lib/hosted-onboarding/env.ts src/lib/hosted-onboarding/webhook-service.ts test/hosted-onboarding-env.test.ts test/hosted-onboarding-linq-dispatch.test.ts test/hosted-onboarding-csrf.test.ts test/hosted-onboarding-runtime.test.ts`
- `git diff --check -- <touched files>`
- `bash scripts/workspace-verify.sh test:diff apps/web/src/lib/hosted-onboarding/env.ts apps/web/src/lib/hosted-onboarding/webhook-service.ts apps/web/test/hosted-onboarding-env.test.ts apps/web/test/hosted-onboarding-linq-dispatch.test.ts apps/web/test/hosted-onboarding-csrf.test.ts apps/web/test/hosted-onboarding-runtime.test.ts apps/web/.env.example apps/web/README.md`
- `pnpm --dir apps/cloudflare test:e2e:linq-webhook:local`

## Reviews

- Security/privacy review: no findings.
- Coverage-write review: no additional proof needed.
- Final review: fixed the duplicate-delay cap edge case, then reran affected checks.
