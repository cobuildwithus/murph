# PR 951 Stripe cancellation serialization follow-up

Status: completed
Created: 2026-07-25
Updated: 2026-07-25

## Goal

- Make auto-trial adoption and loser cancellation share one honest
  serialization boundary, while keeping the cleanup ownership recheck genuinely
  database-only.

## Success criteria

- The member billing lock is held from the final ownership recheck until the
  bounded Stripe cancellation settles.
- The recheck selects only billing status, phase, trial redemption, and the
  blind subscription lookup key; it performs no decrypt or KMS call.
- Cleanup recognizes the subscription lookup key under every readable privacy
  key version.
- A subscription adopted by a concurrent billing flow cannot be cancelled.
- A subscription cancelled by cleanup cannot later be adopted from a stale
  provider snapshot.
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

1. Risk: an external Stripe call extends the finalization and rare cleanup
   transactions.
   Mitigation: use one authoritative provider read inside finalization's member
   lock and the existing explicit five-second request timeout. This is the
   smallest correct boundary because no durable cancellation fence exists.
2. Risk: a broad billing read invokes KMS under the lock.
   Mitigation: add a narrow select-only ownership projection and exact selected
   field assertions.

## Tasks

1. Trace finalization, member-lock, Stripe timeout, and billing projection paths.
2. Move the ownership recheck and cancellation into one locked transaction.
3. Replace the encrypted snapshot with the lookup-key projection.
4. Move the authoritative finalization read inside the same member lock so
   cleanup cannot win first and be followed by stale adoption.
5. Match all readable subscription lookup-key versions during cleanup.
6. Add race/selection/timeout proof and run the required gates.

## Decisions

- Prefer one rare provider-bearing critical section to a new durable cleanup
  coordination mechanism.
- Prefer one bounded provider read in the common finalization critical section
  to a cancellation-fence column, coordination table, or cleanup state machine.
- The original provider-outside-lock shape was rejected after specialist review
  proved the reverse cleanup-before-adoption race.

## Verification

- Required commands: focused hosted auto-trial tests,
  `pnpm test:diff apps/web/src/lib/hosted-onboarding/auto-trial-enrollment-service.ts`,
  `pnpm verify:acceptance`, and the repository ReviewGPT/CI gates.
- Expected outcomes: all pass; the concurrency proof demonstrates that adoption
  and cancellation cannot cross the serialized boundary.
- Current focused result: the auto-trial service and route suites pass with 76
  tests, targeted lint passes, and the hosted-web typecheck passes after the
  canonical Prisma generation step.
- Current canonical result: `pnpm test:diff auto-trial service cleanup store`
  exits successfully after the full hosted-web lane (514 test files and 6,556
  tests passed, with the documented skips), lint, development smoke, and
  production build.
- Current acceptance result: `pnpm verify:acceptance` exits successfully after
  repository guards, workspace typechecks, package coverage, hosted-web
  verification, production build, and both Cloudflare test lanes.
- Current specialist result: the correction-verification pass on
  `193b3732acf9e9c36ebe547c1cc03d18172ddeb8` reports no findings and
  `SPECIALIST_OUTCOME: PASS`. It explicitly rechecked the exact error-code
  assertions and both sides of the shared serialization boundary.
- Current CI result: all completed checks pass; only the runtime checkpoint E2E
  lane remains in progress on the pushed implementation head.
Completed: 2026-07-25
