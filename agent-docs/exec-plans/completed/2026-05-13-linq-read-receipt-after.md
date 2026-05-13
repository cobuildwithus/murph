# Hosted Linq Read Receipt After Response

## Goal

Move hosted Linq ingress read receipts out of the webhook response path and remove the special sub-second read-receipt timeout.

Success criteria:

- Accepted Linq message webhooks still append mailbox work and hand off runner wake before returning.
- Linq read receipts run as a best-effort post-response task from the Next route.
- The read receipt uses the normal Linq client timeout instead of a custom 750ms cap.
- Focused hosted-web tests cover the scheduling and timeout behavior.

## Constraints

- Preserve webhook durability: do not schedule a read receipt before the message is accepted and wake handoff is attempted.
- Keep the shared webhook service framework-neutral; Next-specific `after` usage should stay in the route layer.
- Read receipt failure must not fail accepted webhook responses.
- Preserve unrelated working-tree and ledger edits.

## Current State

- The route injects a post-response scheduler backed by Next `after`.
- The webhook service still decides whether to send the read receipt only after mailbox acceptance and wake handoff.
- The read receipt no longer passes a special 750ms timeout and uses the normal Linq client timeout.

## Plan

1. Add an optional post-response scheduler hook to hosted Linq webhook handling.
2. Use `after` in the Linq route to schedule best-effort read receipts after response.
3. Remove the special 750ms read-receipt timeout from the call and timing details.
4. Update focused route/service tests.
5. Run focused hosted-web tests plus required checks.

## Verification

- Passed: `pnpm --dir apps/web test:prepared test/hosted-onboarding-linq-route.test.ts test/hosted-onboarding-linq-dispatch.test.ts` (49 tests after fallback coverage)
- Passed: `bash scripts/workspace-verify.sh test:diff apps/web/app/api/hosted-onboarding/linq/webhook/route.ts apps/web/src/lib/hosted-onboarding/webhook-service.ts apps/web/test/hosted-onboarding-linq-route.test.ts apps/web/test/hosted-onboarding-linq-dispatch.test.ts`
- Passed: `pnpm --dir apps/web typecheck`
- Passed: security/privacy audit, no findings.
- Passed: final completion audit, no findings; added direct fallback coverage for the reported proof gap.
Status: completed
Updated: 2026-05-13
Completed: 2026-05-13
