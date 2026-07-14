# PR 606 ReviewGPT Billing And Actor Repair

## Objective

Resolve the accepted ReviewGPT finding that incompatible legacy Family billing
can commit a canceled local disposition without one durable, executable Stripe
compensation owner, plus the later exact-head findings that exposed incomplete
payment-authority, actor-ordering, retry, and deletion boundaries.

## Proven Gap

- Subscription and invoice events return a transient cancellation id after the
  database transaction, so a failed provider call can be forgotten when owner
  eligibility changes before retry.
- Checkout compensation persists only blind indexes and exempts only the
  narrow refund-pending error from the poison budget, so an already accepted
  obligation can poison on ordinary retryable provider failures.
- Family sponsorship and direct billing are serialized but not mutually
  exclusive on every creation and activation path, so the later lock winner
  can leave two billing authorities active.
- Reply-time actor detection reads only one source-wide page, so unrelated
  routes can hide a different group actor before a later same-actor input.
- Hosted active-turn sources freeze selection at one causal input, so reply-layer
  actor tests cannot exercise late-input steering in production.
- Marker-only cron enforcement blocks authorized known-direct pre-marker
  schedules indefinitely when no new inbound arrives to carry route proof.
- Event type alone currently suppresses poisoning before Stripe retrieval,
  while a selected Pulse loser cancellation can still poison after its cleanup
  decision is durable.
- Issued Checkout Sessions can outlive account deletion and create an ownerless
  subscription after local billing and crypto state is gone.
- Background route repair can continue provider assertions after fresh input or
  abort, and marker strengthening can stale a device occurrence queued just
  before the repair.
- A persisted open Family Checkout can outlive direct-paid conversion, and a
  generic hosted local Linq cron row has no authenticated parent route to prove
  its saved audience before provider admission.

## Implementation

- Generalize the existing `HostedStripeEvent` receipt to persist one accepted
  event-owned subscription identity and an optional exact invoice identity.
- Encrypt executable provider ids and retain blind indexes for fail-closed
  identity validation.
- Accept cancel-only and cancel-and-refund descriptors in the same transaction
  that writes the terminal local Family disposition.
- On every retry, execute only the accepted descriptor; do not recompute Family
  owner eligibility.
- Keep every post-acceptance provider failure pending without consuming the
  poison budget; preserve poisoning for incomplete or mismatched descriptors.
- Persist Pulse loser cleanup as a separate encrypted, event-owned descriptor
  so retries and account deletion do not depend on reloading or reclassifying
  the Stripe event.
- Delete the transient cancellation-result branch and checkout-only receipt
  path.
- Enforce one Family-versus-direct payment-authority decision under the existing
  member lock across Checkout, webhooks, automatic trials, Start Paid, invite
  acceptance, and legacy migration. Reuse the event-owned compensation receipt
  when a provider object already exists.
- Put one contiguous route/actor query on `AssistantInputSource`. The stored
  owner pages past unrelated routes until the first different actor; the hosted
  owner reads the live pending index so a same-actor prefix can steer the active
  turn while the barrier and every later route input remain pending.
- Before hosted cron, batch known-direct pre-marker Linq routes through a signed
  web assertion that matches only the member's canonical current or pending home
  route, then write the normal trusted marker without changing schedule identity
  or pending occurrence state. Group, unknown, copied, and unverifiable routes
  remain fail-closed.
- Suppress the poison budget only for an accepted compensation owner or selected
  Pulse cleanup, including a catch-time recheck for concurrent acceptance.
- Persist the currently issued direct and Family Checkout Session, revalidate
  after provider creation with an exact predecessor compare-and-set, and clear
  only the exact completed session after canonical billing state is durable.
  Expire issued sessions before account deletion and treat a concurrently
  completed session as another subscription to cancel before local deletion.
- Hold automatic-trial creation and direct-paid-to-Family provider mutations
  inside the existing member/group deletion fences, rechecking suspension and
  payment authority before each charge-capable mutation.
- Discover pre-migration open Checkout Sessions and completed sessions from the
  finite 2026-07-01 through 2026-07-31 deployment-compatibility window, plus unfinalized
  subscriptions with bounded, fail-closed Stripe pagination before deleting
  local state.
- Before account deletion removes personal or owned thread-container crypto
  roots, settle every accepted descriptor fail-closed, revalidate it under the
  normal Family/event locks, and scrub its user-linked ciphertext and indexes.
- When the exact sibling `invoice.paid` arrives for an accepted cancel-and-refund
  obligation, promote that event-owned invoice before executing compensation.
  Account deletion never guesses a charge: a null-invoice obligation remains
  blocking unless a bounded scan proves every discovered invoice terminal and
  zero-paid.
- Hold Pulse customer creation and binding in one member Stripe-mutation
  transaction, and keep provisional customer metadata free of member identity
  so a provider success followed by database rollback cannot leave a durable
  user-linked object outside the deletion fence.
- Convert direct paid billing to Family by atomically updating the existing
  Stripe subscription with `error_if_incomplete`; resolve direct-member
  conflicts under the Family lock before counting seats, and recognize only the
  exact current direct subscription as the intentional conversion authority.
- Rotate legacy route-repair batches hourly, require server-confirmed
  `member-home` authority for every unmarked Linq route before provider
  execution, and propagate that acknowledgement through the Cloudflare runtime
  adapter. A pending repair blocks only its own cron attempt, not unrelated
  due work.
- Yield or abort route repair before further provider assertions or canonical
  writes. Preserve a queued device occurrence only across the exact
  marker-strengthening repair; every other parent-route edit remains stale.
- Settle a persisted Family Checkout under the existing group/member fence
  before direct-paid conversion: expire an open session and fail closed if it
  already completed. Reject hosted local Linq jobs that have no authenticated
  canonical or device parent route, keeping the occurrence retryable.
- Anchor hosted preference causality to the first accepted input even when the
  same actor contributes additional inputs to the active turn.

## Validation

- Prove cancel-only retry survives later owner eligibility changes and sibling
  events cannot reactivate the canceled group.
- Prove an accepted attempt-six checkout compensation remains pending across
  ordinary provider failures and converges on the exact subscription/invoice.
- Prove encrypted descriptor mismatch/corruption fails closed before Stripe
  mutation, and provider idempotency prevents duplicate cancellation/refund.
- Prove account deletion discovers container-owned Family billing, cannot
  delete roots while compensation settlement fails or changes, and scrubs the
  settled descriptor before root deletion.
- Prove both Family/direct lock orders, trial and Start Paid entry points, and
  delayed checkout/subscription/invoice events never commit dual authority.
- Prove more than 100 unrelated route events cannot hide a different group
  actor or advance the persisted cursor past that actor.
- Prove hosted A1/A2/B/A3 ordering exposes A2 to the live A turn and leaves B/A3
  pending across restart.
- Prove a server-confirmed pre-marker direct route is reauthorized before cron,
  while group and mismatched targets remain blocked and the original occurrence
  retains exactly-once execution ownership.
- Prove ordinary retrieval failures still poison at the normal limit, while an
  accepted compensation or Pulse loser cleanup remains pending until success.
- Prove direct and Family Checkout Sessions are expired during deletion and a
  completion race is canceled before local state is removed.
- Prove account deletion preserves a null-invoice paid obligation, exact
  `invoice.paid` promotion converges on the provider invoice, and zero-paid
  terminal invoice history is the only safe scrub case.
- Prove direct-to-Family conversion either commits atomically on the existing
  subscription or leaves direct billing unchanged, and that direct conflicts
  are removed before the Family seat count is evaluated.
- Prove a repair backlog larger than one batch reaches the tail on the next
  hourly retry, both direct and group-shaped unmarked Linq routes remain pending
  before provider execution, and the Cloudflare adapter preserves the signed
  `member-home` acknowledgement.
- Prove repair yield/abort performs no partial write, queue→real repair→execute
  preserves one device occurrence, and unparented hosted local Linq stays
  failed with a scheduled retry before any provider call.
- Prove direct-paid conversion expires a persisted open Family Checkout before
  subscription mutation and makes no billing mutation when that session is
  already complete.
- Prove supported same-actor input folding retains the first accepted input as
  the preference causal anchor.
- Run focused Family/Stripe tests, web typecheck/verification, required audits,
  exact-head ReviewGPT, and CI before merge.

## Completion Evidence

- Family plan tests: 106 passed; account-deletion tests: 63 passed.
- Assistant route-repair core tests: 25 passed; hosted maintenance tests: 77
  passed; full assistant cron runtime file: 108 passed.
- Focused device authority, queue→repair→execute, and unparented local Linq
  admission proofs: 4 passed; the exact retry proof also passed independently.
- Assistant engine, assistant runtime, hosted web, and Cloudflare typechecks
  passed on the rebased patch.
- The broad hosted-web run passed 5,034 tests with one unrelated timeout under
  concurrent load; that exact page test passed in isolation.
- Coverage-write, security/privacy, and final deep-review audits report zero
  remaining actionable findings. The pushed-head ReviewGPT and CI loops remain
  the external merge gates after this local plan is archived.

Status: completed
Updated: 2026-07-14
Completed: 2026-07-14
