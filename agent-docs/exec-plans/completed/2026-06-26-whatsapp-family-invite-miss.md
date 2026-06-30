Goal (incl. success criteria):
- Keep WhatsApp Family invite-token misses from surfacing as provider-visible webhook failures.
- Success means a wrong-phone/expired/full-seat Family token sent over WhatsApp returns an ignored ok response, does not wake the assistant, and still lets unexpected errors fail closed.

Constraints/Assumptions:
- Keep the fix narrow to WhatsApp Family invite ingress.
- Preserve existing Linq behavior and existing hosted ingress wake repair work.
- Do not add durable state for rejected invite attempts.

Key decisions:
- Classify only non-retryable hosted Family invite acceptance business errors as ignored token misses.
- Use the existing `family-invite-not-accepted` reason so provider behavior matches Linq.

State:
- In progress.

Done:
- Identified that WhatsApp currently lets expected Family invite acceptance errors escape the webhook planner.

Now:
- Patch WhatsApp planner and add focused regression coverage.

Next:
- Run focused WhatsApp tests and typecheck before a scoped commit.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- apps/web/src/lib/hosted-onboarding/webhook-provider-whatsapp.ts
- apps/web/test/hosted-onboarding-whatsapp-service.test.ts
Status: completed
Updated: 2026-06-26
Completed: 2026-06-26
