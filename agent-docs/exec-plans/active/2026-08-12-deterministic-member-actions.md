# Deterministic member actions

Status: active
Created: 2026-08-12
Updated: 2026-08-13

## Goal

Let authenticated first-party clients submit bounded, typed data edits through
the existing durable hosted mailbox without invoking a model or creating a
second owner for canonical product state. Ship live-workout editing from the
Messages extension as the first action family.

## Success criteria

- The iMessage-scoped credential can submit a closed, versioned member-action
  envelope after current member-access and consent checks.
- Web owns authentication, validation, idempotent mailbox append, and runtime
  wake only; the assistant runtime dispatches deterministically to the existing
  vault-usecase owner without a model turn.
- A workout edit targets one exact canonical workout snapshot and fails closed
  on stale, ambiguous, completed, malformed, oversized, or unauthorized input.
- Replayed requests converge without duplicate exercises or sets.
- The client observes one durable terminal receipt and never reports an
  asynchronously rejected edit as saved.
- The generic transport can accept future explicitly implemented action kinds
  without adding another auth, mailbox, or persistence stack.
- The companion app exchanges and shares only the existing narrow derived
  credential, while the Messages extension edits and submits the workout
  directly without composer text.

## Constraints

- Keep message-card URLs presentation-only; do not add member identity,
  canonical entity IDs, credentials, or write authority to them.
- Keep canonical product truth in the vault and all workout mutation policy in
  `@murphai/vault-usecases`.
- Use a closed discriminated union and strict bounds; do not expose arbitrary
  paths, patches, database writes, generic JSON commands, or model fallback.
- Reuse the existing hosted mailbox, runtime wake, scoped Messages credential,
  and canonical live-workout lock. Add no database schema, queue, Durable
  Object, service binding, dependency, or second retry owner.
- Preserve foreground conversation priority and existing access, consent,
  deletion, privacy, and hosted-runtime lifecycle invariants.

## Tasks

1. [x] Trace the current scoped credential, mailbox protocol, runtime routing,
   canonical workout owner, and native editor/card boundaries.
2. [x] Define the smallest closed member-action request and workout snapshot
   contracts, including idempotency, staleness, bounds, and response semantics.
3. [x] Implement authenticated mailbox ingress and model-free runtime dispatch
   through the canonical workout use cases.
4. [x] Replace native composer insertion with scoped-credential direct typed
   submission from the capability-less visible snapshot, preserving clear
   loading, success, expiry, and retry states.
5. [x] Run focused contract, route, mailbox, runtime, vault, native, and visual
   proof; inspect the full cross-repository diff and privacy boundary.
6. [ ] Push coordinated PR heads, run the required specialist and final
   ReviewGPT gates with CI, resolve every accepted finding, close this plan,
   and document safe deployment order.

## Decisions

- The public iMessage card remains an immutable presentation snapshot. Direct
  editing derives bounded preconditions plus one opaque exact-workout binding
  from that snapshot; runtime revalidates them against exactly one active
  canonical workout. The binding is not authentication and exposes no canonical
  id, so the message URL remains capability-less.
- The member-action transport owns only request admission and delivery. Each
  action handler delegates to an existing domain use case; workout is the first
  closed handler, not a generic data-store abstraction.
- Core mutation completion remains asynchronous behind the durable mailbox. A
  typed terminal mailbox event is the evidence-backed receipt surface; no new
  table or state owner is added.
- The exact-workout binding and visible prior result are optimistic
  preconditions owned by the workout use case. They prevent delayed delivery
  from targeting a later workout or overwriting a newer set correction without
  adding a second version store. The client timestamp stays stable across an
  exact retry and remains bounded by the credential lifetime at admission.
- A successful foreground reply checkpoint services at most one due requested
  member action through the existing system-mailbox owner before another model
  pass. Completion receipts and unrelated system work retain ordinary ordering.
- Append replay convergence proves the exact action-owned exercise and set
  state; an extra set, different result, or non-canonical order is stale state,
  not an unchanged retry.
- Admission rejects duplicate exercise or set mutation coordinates, keeping one
  action batch single-valued across exact replay.
- Admission and outcome recording reuse the mailbox owner's prepared-crypto
  boundary: provider work finishes before their transactions, while root drift
  retries the full preparation once through the existing fresh-cache owner.
- A set mutation owns only the explicit result field family. Optimistic
  comparison, exact replay, and canonical merge preserve unrelated annotations
  and metrics; existing-set mutations cannot use an ambiguous null clear.
- Expected set state is a separate closed projection whose fields may be null,
  while the result stays strict. This distinguishes partial canonical values
  such as reps-only from a truly empty set without introducing generic patches.

## Verification

- Focused hosted-execution contract/parser/builder tests.
- Focused Web scoped-auth, request-validation, mailbox append, dedupe, and wake
  tests.
- Focused assistant-runtime mailbox routing, retry, foreground-priority, and
  model-free dispatch tests.
- Focused vault-usecase snapshot/version and idempotent workout-apply tests.
- iOS extension model/client/view-model tests, extension-safe typecheck/build,
  formatting, and rendered compact/expanded state proof.
- `git diff --check`, privacy/path inspection, exact-head ReviewGPT gates, and
  required GitHub checks in both repositories.
