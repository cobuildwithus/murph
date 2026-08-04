# Stripe-owned immediate plan upgrades

Status: completed
Created: 2026-08-03
Updated: 2026-08-04

## Goal

- Remove retired hosted-AI metered subscription items from Murph-owned Stripe subscriptions.
- Replace Murph's custom immediate plan mutation and pending-invoice recovery path with Stripe Customer Portal `subscription_update_confirm`.
- Preserve Stripe-webhook ownership of the local billing read model and retain Subscription Schedules for end-of-period downgrades.

## Success criteria

- The legacy-item migration is dry-run by default, idempotent, bounded, and deletes only explicitly marked retired usage items from an otherwise recognized direct Murph subscription.
- Apply mode removes retired metered items without proration or an additional charge, refuses to start while any subscription has a pending update or schedule, and reports only aggregate secret-safe results.
- The immediate upgrade endpoint validates the authenticated member, expected current plan, exact Stripe Customer and Subscription, eligible single licensed item, and target price before returning a dedicated Portal confirmation URL.
- The Portal flow shows Stripe's exact proration, owns payment failure and authentication, and returns to Settings.
- The custom `pending_if_incomplete`, invoice-page recovery, and immediate reconciliation code is deleted.
- Existing scheduled downgrade and trial conversion behavior remains unchanged.
- Focused tests, typecheck/lint, direct rendered desktop/mobile proof, exact-head CI, preliminary specialist ReviewGPT, final ReviewGPT, and parent review pass.

## Architecture

- Stripe owns the immediate commercial mutation through a dedicated Customer Portal configuration and `subscription_update_confirm` deep link.
- Web owns admission: authenticated member, active direct billing authority, expected current plan, no scheduled or pending change, exact Customer/Subscription binding, recognized source item, and allowlisted target plan.
- Stripe webhooks remain the only normal asynchronous owner that projects the resulting Subscription into Postgres and wakes hosted execution.
- Stripe price identity is canonical after the Portal applies the change. Existing mutable `billingPlanCode` metadata remains non-authoritative and is not used as payment or entitlement proof.
- The retired usage-item cleanup is an operator migration, not a user-path side effect. Portal cutover fails closed on any subscription that is not already the canonical one-item shape.

## Rollout

1. From the exact reviewed release head, run the guarded command in dry-run mode against the intended Stripe mode and review aggregate candidate, blocked, and unsupported counts before deploying that head.
2. Resolve subscriptions with a live `pending_update` or Subscription Schedule separately, then run apply mode with the exact fresh candidate count.
3. Rerun dry-run and require zero eligible legacy items and zero unexplained unsupported shapes.
4. Configure the dedicated Portal configuration for the direct Pulse-to-Edge product/price transition.
5. Verify successful, declined-card, 3DS, cancel-return, completed-return, webhook, and entitlement scenarios in Stripe test mode.
6. Deploy the Portal confirmation path only after the live cleanup is verified, then canary the same journeys in production.

## Constraints

- Never print Stripe Customer, Subscription, Subscription Item, member, email, or payment-method identifiers from the migration.
- Never delete an unmarked metered item, quantity-bearing item, licensed item, or unknown add-on.
- Do not make provider I/O while holding the hosted-member database transaction lock.
- Do not turn Customer Portal into the owner of scheduled downgrades or local entitlement state.
- Do not preserve custom invoice recovery as a fallback after the cutover.

## Verification

- Focused Vitest for the migration classifier/executor, immediate-upgrade service, Settings route, assistant subscription projection, Stripe event reconciliation, and affected components.
- `pnpm --dir apps/web typecheck`
- `pnpm --dir apps/web lint`
- Desktop and mobile design-catalog screenshots of the real plan-change component.
- Stripe test-mode direct journey, or an explicit credential/configuration blocker with the closest mocked and rendered proof.
- Exact-head GitHub Actions, preliminary specialist ReviewGPT, and final ReviewGPT.
Completed: 2026-08-04
