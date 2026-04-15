## Goal

Collapse hosted managed-user crypto provisioning to one correctness owner at the Cloudflare activation boundary while preserving fail-closed runtime access and existing activation correctness.

## Scope

- `apps/web/app/api/hosted-onboarding/privy/complete/route.ts`
- `apps/web/app/api/hosted-onboarding/billing/checkout/route.ts`
- `apps/web/src/lib/hosted-execution/control.ts`
- `apps/web/src/lib/hosted-onboarding/member-activation.ts`
- `apps/web/src/lib/hosted-onboarding/stripe-event-reconciliation.ts`
- `apps/web/src/lib/hosted-onboarding/billing-success-service.ts`
- `apps/web/src/lib/hosted-onboarding/stripe-revnet-reconciliation.ts`
- `apps/cloudflare/src/user-key-store.ts`
- `apps/cloudflare/src/user-runner.ts`
- `apps/cloudflare/src/user-runner/runner-dispatch-processor.ts`
- Focused tests covering those paths

## Guardrails

- Keep runtime access fail-closed when managed crypto has not been provisioned.
- Keep `member.activated` dispatch idempotent and safe across retries/replays.
- Prefer deleting duplicate ownership and duplicate work over adding new abstraction.
- Do not weaken support or migration recovery options unless they are strictly redundant with the activation boundary.

## Plan

1. Remove web-owned speculative warmups and post-commit provisioning from onboarding flows.
2. Split Cloudflare key-store semantics so envelope ensure does not always unwrap runtime crypto.
3. Keep exactly one activation-time ensure at the hosted runner boundary and remove duplicate provisioning deeper in dispatch processing.
4. Update focused tests to reflect the single-owner architecture and fail-closed runtime behavior.
5. Run truthful verification for the touched apps, complete required audits, and commit the scoped refactor.
Status: completed
Updated: 2026-04-15
Completed: 2026-04-15
