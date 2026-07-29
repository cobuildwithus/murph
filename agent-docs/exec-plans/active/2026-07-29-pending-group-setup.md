# Prepare ownership of the next Murph group

Status: active
Created: 2026-07-29
Updated: 2026-07-29

## Goal

- Let an active member explicitly prepare ownership of the next new Linq group
  that contains them, without relying on unreliable provider add-actor data.
- Preserve one canonical owner, one route-provisioning primitive, and the
  existing first-active-sender fallback when no intent can be selected safely.

## Success criteria

- One 30-minute, one-use intent exists per person member and is scoped to that
  member's current managed Murph Linq line.
- A lone roster-matched prepared member owns the new synthetic group runtime
  even when another active member sends the first message.
- When several roster members prepared an intent, the current sender wins only
  when the sender has one; otherwise Murph does not guess.
- One intent can initialize at most one newly created route under concurrent
  messages or simultaneous new groups.
- Existing routes never consume an intent or change owner.
- No raw roster handle, chat id, provider actor, message, style, room context,
  or contact label enters pending state or diagnostics.

## Scope

- Private-text `murph.group` actions to prepare, read, and cancel the intent.
- A minimal Postgres row containing only owner, blinded line key, and times.
- One bounded provider roster read before an unbound-group transaction.
- Bounded roster-handle resolution to known member ids.
- Deterministic candidate selection and atomic one-use claim.
- Composition over the existing canonical thread-container and referral owners.
- Focused unit, webhook, schema/privacy, and PostgreSQL concurrency proof.
- Durable architecture, security, reliability, product, skill, and testing-map
  documentation.

## Constraints

- `HostedThreadContainer.ownerMemberId` remains the only canonical group owner.
- The provider adapter accepts only resolved member ids, never raw handles.
- `participant.added` actor data is not authority.
- Provider I/O stays outside the database transaction and is bounded.
- No cleanup scheduler: expiry is query-time authority; replacement,
  cancellation, claim, and member deletion remove state.
- No generalized draft-group subsystem or second provider abstraction.

## Design

1. A fresh private text turn arms one setup for the active person's current
   managed Linq line; a newer setup atomically replaces the older one.
2. Before the first inbound for an unbound Linq group, Web performs one bounded
   current-chat read and resolves at most 32 active non-Murph handles to member
   ids. Failure leaves the participant list empty.
3. Inside the route transaction, candidate selection is:
   - one candidate: select it;
   - several candidates and sender owns one: select the sender's;
   - otherwise: select none.
4. `DELETE ... RETURNING` claims the selected setup exactly once. A concurrent
   claimant re-evaluates without it.
5. The selected member, or the existing sender fallback, is passed to
   `ensureHostedThreadContainerRouteTx`. That primitive remains the only route
   and owner writer and retains its existing usage-referral composition.
6. An existing-route convergence or recoverable admission failure restores the
   still-valid intent; a successful new route consumes it.

## Risks and mitigations

1. **Two groups consume one intent.** One transactional delete is the
   linearization point; the opt-in PostgreSQL test races two claimants.
2. **Stale or incomplete provider roster.** The lookup is advisory matching
   evidence only; failure or ambiguity preserves sender-owner admission.
3. **Wrong line or inactive member prepares state.** Arm and claim both bind the
   current routing key and current runtime-access predicate.
4. **Existing ownership changes.** The canonical ensure primitive rejects or
   converges on the existing route and the setup is restored.
5. **Private contact data spreads.** Pending state contains no raw provider
   value, logs only a closed outcome, and account deletion cascades the row.
6. **Foreground latency grows.** The provider call is one non-retried 1.5-second
   read before the transaction and resolution is capped at 32 handles.

## Tasks

1. [x] Replace the draft style/context payload with a minimal ownership intent.
2. [x] Add private prepare/read/cancel tool contracts and execution gating.
3. [x] Add bounded pre-transaction roster acquisition and member-id projection.
4. [x] Compose new-group owner resolution with the canonical route primitive.
5. [x] Add selection, composition, tool, parser, webhook, schema/privacy, and
   PostgreSQL concurrency coverage.
6. [x] Update durable owner and product documentation.
7. [ ] Complete canonical verification and preliminary specialist review.
8. [ ] Push the exact head, run final ReviewGPT concurrently with CI, resolve
   findings, and leave the draft PR ready to merge.

## Decisions

- Prefer one explicit short-lived intent over an add-actor heuristic, roster
  ordering, timing inference, or pending-owner state machine.
- Treat roster membership as matching evidence, not ownership. The private
  member intent supplies the ownership claim.
- Preserve existing behavior whenever the intent cannot be selected safely.
- Keep the PR draft until exact-head review and required CI are green.

## Verification

- Full Web, hosted-execution, and assistant-engine typechecks pass locally.
- Focused and canonical diff/acceptance suites, PostgreSQL concurrency proof,
  preliminary specialist review, final ReviewGPT, and exact-head CI remain to
  be recorded before completion.
