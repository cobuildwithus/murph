Goal (incl. success criteria):
- Add an authenticated hosted ops surface that can issue or reuse a hosted onboarding invite for a phone number, then deliver the signup link into either an existing Linq chat or a newly created one.
- Support an optional uploaded voice memo on the same form without storing the uploaded bytes in Murph.
- Success means ops users can send/resend a signup link from `/ops/onboarding-invites`, optionally attach a native Linq voice memo, and receive a redacted result with invite/chat/message metadata.

Constraints/Assumptions:
- This is operator-triggered delivery only; do not introduce automated outreach or background retry behavior.
- Keep raw phone numbers, provider tokens, uploaded audio bytes, and attachment URLs out of logs and durable docs.
- Use the existing hosted ops auth gate and hosted invite primitives.
- Deliver a text signup link even when a voice memo is attached so the invite URL remains inspectable and reachable.
- Treat the voice memo as pass-through to Linq; Murph must not persist the file.

Key decisions:
- Reuse the existing invite for a member while it is unexpired, updating the invite channel to `linq`.
- Model the submit request with an operator-generated request id so provider idempotency prevents double-click duplicate sends without blocking intentional later resends.
- Send text first, then send the optional voice memo to the resolved chat id.

State:
- Complete; closing with the scoped commit.

Done:
- Read hosted runtime, ops, deliverability, security, reliability, frontend, product, and design guidance.
- Confirmed the Linq SDK supports native voice memo sends via the chat voice memo endpoint.
- Added the hosted ops onboarding invite service, authenticated API route, ops page form, Linq attachment/voice helpers, and focused coverage.
- Verified the exact final diff with serial diff-aware workspace verification.

Now:
- Close the plan with the scoped commit.

Next:
- Open the PR and hand off the route.

Open questions (UNCONFIRMED if needed):
- None blocking implementation.

Working set (files/ids/commands):
- apps/web/src/lib/hosted-ops/onboarding-invites.ts
- apps/web/src/lib/hosted-onboarding/linq-client.ts
- apps/web/app/api/ops/onboarding-invites/route.ts
- apps/web/app/(dashboard)/ops/onboarding-invites/page.tsx
- apps/web/app/(dashboard)/ops/onboarding-invites/onboarding-invites-client.tsx
- apps/web/test/hosted-ops-onboarding-invites.test.ts
- apps/web/test/hosted-onboarding-linq-http.test.ts
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-ops-onboarding-invites.test.ts apps/web/test/hosted-onboarding-linq-http.test.ts`
- `pnpm --dir apps/web typecheck:prepared`
- `env MURPH_VERIFY_STEP_PARALLEL=0 bash scripts/workspace-verify.sh test:diff ...`
Status: completed
Updated: 2026-06-29
Completed: 2026-06-29
