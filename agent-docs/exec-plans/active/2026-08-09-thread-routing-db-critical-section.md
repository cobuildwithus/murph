# Refactor thread-container crypto preparation and route refresh

Status: active
Created: 2026-08-09
Updated: 2026-08-09

## Goal

- Keep first group-thread admission retry-safe and atomic while moving KMS and
  variable route encryption out of the database critical section.

## Success criteria

- A synthetic member id, all four domain-root envelope candidates, the sealed
  delivery route, and the ingress-root prewarm are prepared before `BEGIN`.
- The creation transaction commits the member, prepared roots, container,
  route, and activation mailbox item atomically without the legacy all-domain
  crypto bridge.
- Concurrent creation is decided by the existing unique external-thread
  identity; a losing transaction rolls back and the handler performs one fresh
  prepare-before-transaction attempt against the winning route.
- Existing route refresh performs no KMS work while its transaction is open.
- Focused unit, typecheck, and PostgreSQL concurrency proof pass on the final
  candidate; exact-head CI and required ReviewGPT gates are green.

## Scope

- In scope: hosted Web thread-container creation and delivery-route refresh,
  their Linq/Telegram preparation plumbing, focused tests, and matching durable
  architecture/reliability/testing claims if behavior changes materially.
- Out of scope: schema changes, new persisted state, mailbox protocol changes,
  unrelated advisory-lock owners, and the remaining inbound Family legacy
  crypto bridge.

## Constraints

- Technical constraints: preserve owner and participant authority checks,
  pending-group setup semantics, route/account binding, atomic activation wake,
  privacy-key rotation, and rollback on unique conflict. Never retain plaintext
  domain-root bytes beyond the existing request-scoped unwrap cache.
- Product/process constraints: smallest maintainable change, isolated task
  worktree, focused local proof before PR, preliminary coverage specialist plus
  the sensitive final ReviewGPT gate, green exact-head CI, parent final review,
  and scoped plan-closing commit.

## Risks and mitigations

1. Risk: speculative preparation is accidentally treated as route authority.
   Mitigation: repeat all owner/route checks in the transaction and let only the
   unique external-thread row decide concurrent creation.
2. Risk: a prepared ciphertext is applied to a different container or route.
   Mitigation: bind prepared material to container id, channel, and normalized
   thread route and validate that binding before every write.
3. Risk: moving preparation outside `BEGIN` causes a KMS retry inside the
   transaction on a cache miss.
   Mitigation: make creation/refresh writes require prepared material and add
   ordering tests that fail if the transaction opens before preparation.

## Tasks

1. Trace creation, refresh, Linq, Telegram, crypto-cache, mailbox, and
   concurrency owners; capture the current lock/KMS path in focused tests.
2. Add bounded prepared route/container inputs and remove the creation-time
   legacy crypto bridge plus creation advisory lock.
3. Plumb preparation through Linq and Telegram before their planning
   transactions and preserve unique-conflict convergence.
4. Run focused unit/typecheck/PostgreSQL proof, inspect the diff, and update any
   durable owner claims required by the final behavior.
5. Commit and push the candidate, run the preliminary specialist and final
   ReviewGPT gates concurrently with CI, resolve accepted findings, perform the
   parent final review, close the plan, and hand off the PR.

## Decisions

- Reuse the existing external-thread unique identity rather than adding another
  lock or state owner.
- Keep mailbox lane/causal allocation inside the transaction; prewarm only the
  ingress root because the allocated sequence is authenticated payload metadata.
- Retain route-update serialization for existing rows unless focused
  concurrency evidence proves it redundant; remove the advisory lock only from
  the absent-row creation path.

## Verification

- Commands to run: focused hosted Web Vitest slices for thread routing and
  pre-transaction crypto ordering; app-local typecheck/lint as selected by the
  final diff; the existing opt-in PostgreSQL route concurrency case; exact-head
  required GitHub Actions.
- Expected outcomes: no legacy bridge call from thread-container creation, no
  KMS operation begins after transaction open, one concurrent external thread
  route wins with no orphaned synthetic state, and all existing routing,
  activation, privacy-rotation, and mailbox assertions remain green.
