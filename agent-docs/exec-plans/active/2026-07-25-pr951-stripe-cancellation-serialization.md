# PR 951 Stripe cancellation serialization follow-up

Status: active
Created: 2026-07-25
Updated: 2026-07-25

## Goal

- Preserve the two-phase common path while making rare loser-subscription
  cleanup serialize through Stripe cancellation and use a genuinely
  database-only ownership recheck.

## Success criteria

- The member billing lock is held from the final ownership recheck until the
  bounded Stripe cancellation settles.
- The recheck selects only billing status, phase, trial redemption, and the
  blind subscription lookup key; it performs no decrypt or KMS call.
- A subscription adopted by a concurrent billing flow cannot be cancelled.
- Focused, full acceptance, specialist ReviewGPT, final parent review, final
  ReviewGPT, and CI are green on the pushed head.

## Scope

- In scope: auto-trial loser cleanup, narrow billing projection, and focused
  concurrency/selection tests.
- Out of scope: refactoring every Stripe-under-lock path, a cleanup state
  machine, outbox, queue, or new coordination table.

## Constraints

- Technical constraints: retain the existing member lock ordering and bounded
  transaction timeout; compare blind lookup keys rather than decrypting ids.
- Product/process constraints: never cancel a subscription after another
  serialized flow adopts it; do not degrade trial enrollment.

## Risks and mitigations

1. Risk: an external Stripe call extends a rare transaction.
   Mitigation: keep this only on loser cleanup, preserve the provider-free common
   path, and use the existing explicit cancellation timeout.
2. Risk: a broad billing read invokes KMS under the lock.
   Mitigation: add a narrow select-only ownership projection and exact selected
   field assertions.

## Tasks

1. Trace finalization, member-lock, Stripe timeout, and billing projection paths.
2. Move the ownership recheck and cancellation into one locked transaction.
3. Replace the encrypted snapshot with the lookup-key projection.
4. Add race/selection/timeout proof and run the required gates.

## Decisions

- Prefer one rare provider-bearing critical section to a new durable cleanup
  coordination mechanism.

## Verification

- Commands to run: focused hosted auto-trial tests,
  `pnpm test:diff apps/web/src/lib/hosted-onboarding/auto-trial-enrollment-service.ts`,
  `pnpm verify:acceptance`, and the repository ReviewGPT/CI gates.
- Expected outcomes: all pass; the concurrency proof demonstrates that adoption
  and cancellation cannot cross the serialized boundary.
