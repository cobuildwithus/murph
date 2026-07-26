# Hosted crypto transaction cleanup

Status: active
Created: 2026-07-26
Updated: 2026-07-26

## Goal

- Remove avoidable KMS work from hosted Family activation and established Linq
  ingress transactions while preserving authoritative in-transaction identity,
  membership, routing, billing, and activation checks.

## Success criteria

- Active Family Stripe reconciliation prepares the bounded root-candidate set
  before its owning transaction and never signs candidates while the owner and
  member locks are held.
- Established direct-message and group-route ingress unwraps the active
  member's ingress root before the planner transaction; speculative preflight
  never grants routing or activation authority.
- Expired, revoked, or already-claimed browser Family invites fail their cheap
  preflight without generating root candidates, while the claim transaction
  repeats every authoritative check.
- Durable crypto and Family docs accurately describe the unique-index race
  boundary, provider-capable legacy owners, transaction-scoped advisory-lock
  lifetime, and complete provider-call bound.
- Focused ordering, denial, stale-preflight, race, maximum-cardinality, and
  provider-failure tests plus canonical verification and review gates pass.

## Scope

- In scope: hosted crypto root preparation/commit comments, active Family Stripe
  activation orchestration, browser Family invite preflight, established Linq
  direct/group prewarming, focused hosted-web tests, and live Family/crypto docs.
- Out of scope: new persisted state, queues, caches, activation markers, schema
  changes, deleting the prewarm helper, pre-provisioning roots as activation
  proof, newly-created thread containers, phone/Telegram Family identity
  creation, and unrelated Stripe convergence behavior from PR #972.

## Constraints

- Advisory-lock re-read and the active-envelope partial unique index remain the
  final root-envelope race boundary.
- Preflight reads are hints only. Existing transaction checks remain the sole
  authority for identity, route, invite, membership, billing, and activation.
- Never generate crypto work for an unauthorized or deterministically denied
  request when the denial can be established from the same safe preflight
  predicate.
- Keep plaintext roots ephemeral and retain existing zeroization and scoped
  unwrap-cache behavior.
- Preserve product-critical signup, Family acceptance, activation, billing, and
  current-inbound reply flows.
- Coordinate Family-file overlap with open PR #972 and webhook-file overlap
  with the active hosted-ingress-wake-repair lane; do not absorb their unrelated
  changes.

## Risks and mitigations

1. Risk: a membership or route changes after preflight.
   Mitigation: retain exact authoritative reads and typed missing-candidate
   failure inside the transaction; discard stale prepared work.
2. Risk: prewarming a not-yet-active or unauthorized member leaks provider work
   or caches a missing-root failure.
   Mitigation: prewarm only active, already-provisioned members resolved by a
   narrow read-only target lookup; keep activation paths inside the transaction.
3. Risk: moving durable provisioning ahead of activation makes complete roots
   look like activation proof.
   Mitigation: prepare signed candidates only; do not insert roots before the
   authoritative activation transaction.
4. Risk: Family maximum-cardinality provider latency still exceeds the
   transaction budget through post-commit unwraps.
   Mitigation: move the 42-call generation bound out first, document the
   remaining 12 decrypts and transaction-scoped lock lifetime, and avoid a
   plaintext-root redesign without a separate activation-proof owner.

## Tasks

1. Trace current Family, invite, webhook, crypto, and mailbox ownership against
   current `origin/main` and add focused failing ordering/denial tests.
2. Implement bounded Family candidate preparation and authoritative
   transaction propagation.
3. Implement established direct/group ingress preflight and unwrap-cache
   propagation without widening routing authority.
4. Tighten invite preflight and correct current source/durable documentation.
5. Run focused checks, canonical diff verification, acceptance, mandatory
   specialist/product/final review gates, and current-head CI.
6. Close the plan with a scoped commit, push, and open the PR with overlap and
   deployment notes.

## Decisions

- Keep this as one user-requested cleanup PR while preserving two explicit
  ownership seams: Family activation and established ingress.
- Prefer candidate preparation over durable pre-provisioning for rootless Family
  members so existing activation-proof semantics do not change.
- Leave known-member identity reconciliation, newly-created thread containers,
  and phone/Telegram Family identity creation on their explicit bounded legacy
  bridges; they were reviewed as lower-priority one-time paths.

## Verification

- Focused hosted-web proof passed:
  - 419 tests across crypto roots, Family activation/invites, Stripe
    reconciliation, and Linq prewarm/dispatch.
  - 116 adjacent tests across established route, thread, webhook,
    first-contact, and member-activation paths.
  - Hosted-web TypeScript 7 typecheck and scoped lint passed; lint reported only
    the repository's pre-existing warnings.
- Product-experience review found one direct-paid-to-Family early-owner path
  that could retry forever without preparing the owner candidate. The path was
  corrected for both subscription and invoice events, covered with regression
  tests, and the follow-up product review passed.
- Preliminary completion-specialist review returned three medium coverage
  findings. The exact-thread test-only patch was inspected in full and applied
  for missing-invite denial ordering and all three Stripe billing adapter
  propagation paths. Parent-authored cases prove both first-contact allow
  replan paths warm and zeroize before their second planner transaction.
  Focused remediation proof passed 321 tests.
- Corrected canonical `pnpm test:diff ...` passed on fresh Blacksmith Testbox
  `tbx_01kygb66rxws8qc7whdmd2z2a0`: repository guards, hosted-web typecheck,
  531 test files / 6,761 tests, lint, development smoke, and production build.
- Full acceptance, final ReviewGPT, and current-head CI remain pending.
