## Goal

Move hosted Linq ingress read receipts out of the inline webhook request and into the pointer-only durable webhook workflow, while keeping workflow state free of channel identifiers and message payloads.

## Scope

- `apps/web/src/lib/hosted-onboarding/webhook-service.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-workflow-steps.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-workflows.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-workflow-types.ts` if needed
- Focused hosted onboarding Linq and webhook workflow tests

## Constraints

- Workflow input must remain pointer-only: mailbox item id plus source label only.
- Do not store chat ids, phone numbers, message bodies, webhook payloads, or provider response payloads in workflow state.
- Read receipts must stay best-effort and must not block webhook acknowledgement or runner nudge progress.
- Do not move read acknowledgements into the hosted runtime mailbox-import/assistant-admission path.
- Preserve the existing runner nudge behavior and fallback semantics.

## Verification

- Focused hosted onboarding Linq dispatch tests.
- Focused hosted onboarding webhook workflow tests.
- Routed app verification or truthful diff-aware test coverage, plus typecheck if feasible.
Status: completed
Updated: 2026-05-03
Completed: 2026-05-03
