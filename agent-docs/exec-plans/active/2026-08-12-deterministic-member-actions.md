# Deterministic member actions

Status: active
Created: 2026-08-12
Updated: 2026-08-14

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
- A first workout edit targets one exact canonical active-workout snapshot and
  fails closed on stale, ambiguous, completed, malformed, oversized, or
  unauthorized input; an exact persisted retry still converges after completion.
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
- The exact-workout binding incorporates the workout's ordered hidden
  exercise/set-slot identity plus its last applied member-action generation.
  Every different action must match that current revision before positional
  mutation, so a stale card cannot retarget either a compacted set or a
  same-name exercise moved by the generic workout editor. Mutable set results
  and annotations remain outside the identity binding and under their existing
  result-family compare-and-merge path. Exact action-id replay is resolved first
  because its own successful write necessarily changed that generation.
- If repeated exercise blocks have the same projected coordinate identity after
  exercise order is excluded, the binding cannot prove which block moved
  without claiming mutable result ownership. The card author keeps that workout
  on read-only V4, and the canonical owner rejects already-issued V6 actions
  while the current workout remains ambiguous.
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
- The assistant may author only the readable workout presentation. At response
  attachment, runtime re-reads the exact canonical workout and adds a private
  typed editor projection when names, counts, and logged states match. V6
  carries that projection, including zero and explicit-versus-inherited units;
  V4 remains the read-only fallback for mismatches, read failures, completed
  workouts, and payloads that exceed the existing inline ceiling.
- A note enters the editable projection only when its exact canonical value is
  fully visible in the 40-character result field. Longer hidden notes force the
  whole card to the V4/read-only path so they cannot enter persisted card state
  or the provider request under a generic display label.
- Every completed set enters V6 only when its entire canonical result is exactly
  one supported note, reps, or weight/reps family. Unsupported or mixed result
  fields keep the whole immutable card on V4 so attachment cannot replace a
  truthful actual with a reduced editable value.
- Admission rejects destructive batches whose final typed visible set sequence
  recreates their prestate because those batches have no observable structural
  effect. The canonical workout write atomically stores the bounded action id;
  that exact marker replaces visible-state replay inference and avoids stable
  client-visible set ids or a second receipt store.
- The canonical owner resolves that exact marker across the same bounded workout
  read before enforcing active-only first-application rules. Completion retains
  the marker, and a later active workout cannot capture or invalidate the replay.
- The generic workout edit path retains its saved-set deletion guard. Only the
  live-workout member-action owner may use the narrow set-removal persistence
  path, after exact binding, full snapshot, exercise retention, and final-set
  checks pass under the canonical workout lock.

## Verification

- Focused hosted-execution contract/parser/builder tests.
- Focused Web scoped-auth, request-validation, mailbox append, dedupe, and wake
  tests.
- Focused assistant-runtime mailbox routing, retry, foreground-priority, and
  model-free dispatch tests.
- Focused vault-usecase snapshot/version and idempotent workout-apply tests.
- Real-vault persistence tests for tail, middle, multiple, remove-plus-append,
  exact-retry, final-set rejection, and the generic no-deletion guard.
- iOS extension model/client/view-model tests, extension-safe typecheck/build,
  formatting, and rendered compact/expanded state proof.
- `git diff --check`, privacy/path inspection, exact-head ReviewGPT gates, and
  required GitHub checks in both repositories.
