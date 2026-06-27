# PR 328 ReviewGPT Round 1

## Goal

Resolve the accepted ReviewGPT round-1 invariant finding for PR 328: hosted-web Linq request bodies must also use the pinned canonical Linq SDK request types instead of bespoke hand-shaped provider JSON.

Success criteria:

- `apps/web` pins `@linqapp/sdk` exactly to `0.28.0`.
- Hosted onboarding Linq chat-message, chat-create, and webhook-subscription request bodies are typed from the Linq SDK.
- Webhook subscription events fail closed against the SDK event union.
- Focused hosted-web tests, typecheck, dependency checks, commit, push, and the next ReviewGPT round complete.

## Constraints/Assumptions

- Preserve the current hosted-web Linq transport, timeout, credential ownership, URLs, retry classification, and response parsing.
- Do not introduce a cross-package runtime abstraction for this fix.
- Keep ReviewGPT artifacts under `audit-packages/` local and uncommitted.

## Work Plan

1. Add the exact hosted-web Linq SDK dependency and lockfile entry.
2. Type hosted-web Linq request builders with SDK request parameter types.
3. Add focused coverage for the SDK event fail-closed boundary.
4. Run focused tests, typecheck, dependency checks, final diff review.
5. Commit, push, and run ReviewGPT round 2 on the pushed PR head.

## Verification

- PASS: `pnpm install --lockfile-only --frozen-lockfile`
- PASS: `pnpm --filter @murphai/hosted-web prisma:generate && pnpm --filter @murphai/hosted-web exec vitest run --config vitest.workspace.ts --no-coverage test/hosted-onboarding-linq-http.test.ts test/hosted-onboarding-linq-first-contact-admission.test.ts`
- PASS: `pnpm --filter @murphai/hosted-web typecheck:prepared`
- PASS: `pnpm deps:guard`
- PASS: `pnpm deps:ignored-builds`
- PASS: `pnpm install --frozen-lockfile`
- PASS: `git diff --check`
- FAIL (pre-existing transitive advisories outside the new SDK packages): `pnpm deps:audit`
Status: completed
Updated: 2026-06-26
Completed: 2026-06-26
