# Hosted usage gate pending nudge notice

Status: completed
Created: 2026-05-08
Updated: 2026-05-08

## Goal

When a hosted runner start is denied by the AI usage gate while user input is pending, send the same one-shot usage notice that the Linq webhook path sends, if the member has a home Linq route and the notice has not already been claimed.

Success criteria:

- Runner-side usage denials caused by pending user input no longer fail silently.
- Scheduled/background runner drains do not proactively text users.
- Existing period-level one-shot notice behavior is preserved.
- Focused tests cover the internal usage-gate request context and the runner request body.

## Scope

In scope:

- `apps/web` internal hosted AI usage gate route and helper logic.
- `apps/cloudflare` runner usage-gate callback body.
- Focused hosted-web and Cloudflare tests.

Out of scope:

- New persisted state.
- Changing allowance math, Stripe entitlement logic, or usage accounting.
- Adding proactive notices for background scheduled work with no pending user input.

## Risks

- Sending notices from background runner drains could feel spammy.
  Mitigation: require an explicit pending-nudge context from Cloudflare.
- Delivery failure must not change the gate decision.
  Mitigation: treat outbound notice send as best effort after the gate decision is known.
- One-shot state could suppress the webhook reply.
  Mitigation: reuse the same `claimHostedAiUsageLimitNotice` helper so exactly one path wins.

## Verification

Planned:

- Focused hosted-web tests for usage gate route notification behavior.
- Focused Cloudflare runner test for pending-nudge notification context.
- Required repo verification from `agent-docs/operations/verification-and-runtime.md`.

Results so far:

- `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-execution-usage-gate-route.test.ts apps/web/test/hosted-execution-usage-gate-notice.test.ts` passed.
- `pnpm --dir apps/cloudflare test -- test/user-runner-alarm.test.ts` passed.
- `pnpm typecheck` passed.
- `pnpm test:diff apps/web/app/api/internal/hosted-execution/usage/gate/route.ts apps/web/src/lib/hosted-execution/usage-gate-notice.ts apps/web/test/hosted-execution-usage-gate-route.test.ts apps/web/test/hosted-execution-usage-gate-notice.test.ts apps/cloudflare/src/user-runner.ts apps/cloudflare/test/user-runner-alarm.test.ts` passed guards and apps/cloudflare verify, then failed in apps/web verify on unrelated hosted billing settings and Health Commons biomarker tests.
- Security/privacy review found two low findings; both fixed by using the home-Linq route reader and applying `maxBodyBytes: 512` to callback verification.
- Coverage-write added tests for bounded body parsing and best-effort delivery failure.
- Final review found notification lookup/claim failures could mask the usage-gate decision; fixed by catching the whole notification side effect and returning `failed`.
- Re-ran focused hosted-web tests after final-review fix; passed.
- Re-ran `pnpm typecheck` after final-review fix; passed.
Completed: 2026-05-08
