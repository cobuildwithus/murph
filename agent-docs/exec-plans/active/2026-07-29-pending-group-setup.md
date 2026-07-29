# Prepare the next Murph group

Status: active
Created: 2026-07-29
Updated: 2026-07-29

## Goal

- Let an active member prepare the style and lightweight social context for the
  next new Linq group containing them, without creating a draft group, second
  ownership model, or provider-actor dependency.
- Match that explicit short-lived intent against the first new-group roster;
  when several roster members prepared a setup, the current authenticated
  sender's own setup is the only automatic tie-breaker.

## Success criteria

- One encrypted, expiring setup exists per member and is scoped to the Murph
  Linq line from which it was prepared.
- One roster-matched candidate owns and initializes the new synthetic group
  runtime even when another participant sends the first message.
- With several candidates, the sender's setup wins only when the sender owns one;
  otherwise no setup is guessed and the existing sender-owner fallback remains.
- One setup can initialize at most one newly created route, including under
  concurrent first messages or simultaneous new groups.
- Group style reuses the existing hosted-member preference owner and mailbox
  convergence path. Qualitative context targets the existing fixed group room
  model; there is no second prompt or preference store.
- Existing routes never consume a pending setup or change owner.

## Scope

- In scope now:
  - the encrypted pending-setup store and migration;
  - strict versioned payload validation;
  - deterministic candidate selection and atomic one-time claim;
  - a reusable composition over the existing thread-container, preference, and
    usage-referral owners;
  - focused conflict and payload tests.
- Still to wire before this PR is shippable:
  - private-conversation `murph.group` prepare/read/cancel actions with trusted
    current Linq-line context;
  - bounded provider-roster lookup before the Web transaction and blind-index
    resolution to member ids;
  - the Linq new-group planner call into the prepared-route composition;
  - an optional activation bootstrap field that initializes the existing group
    room-model page before the first conversation turn;
  - production-faithful transaction/concurrency tests and account-deletion
    export coverage;
  - durable architecture, security, privacy, product, and testing-map updates.

## Constraints

- Keep `HostedThreadContainer.ownerMemberId` as the only canonical room owner.
- Keep the synthetic thread-container member and its existing preference columns
  as the only group style owner.
- Do not use `participant.added` actor data; Linq reports that source as
  unreliable.
- Provider calls happen before the database transaction. Only bounded normalized
  roster evidence enters the transaction.
- Raw roster handles are never persisted in setup state.
- Do not create a cleanup scheduler: expiry is query-time authority and stale
  rows disappear on replacement, cancellation, or owner deletion.
- Do not generalize beyond Linq until a second provider has the same product
  requirement.

## Design

1. A private authenticated turn arms one `hosted_pending_group_setup` row for
   the current member and current Murph line. A newer setup atomically replaces
   the older one.
2. The encrypted v1 payload contains only sparse existing style settings and an
   optional bounded Markdown seed for the fixed group room model.
3. On the first message for an unbound Linq thread, the adapter fetches the
   current roster outside the transaction and resolves only known active Murph
   member ids.
4. Inside the transaction, candidate selection follows one rule:
   - one candidate: select it;
   - several candidates and sender owns one: select the sender's;
   - otherwise: select none.
5. `DELETE ... RETURNING` is the one-time setup claim. The surrounding route
   transaction restores the row automatically on failure. A second group racing
   for the same setup loses the claim and re-evaluates without it.
6. The selected setup owner is passed to the existing
   `ensureHostedThreadContainerRouteTx`. If no setup was selected, the existing
   authenticated sender remains the fallback owner.
7. When the route is newly created, style is applied through
   `upsertHostedMemberAssistantPreferencesTx`, and the existing usage-referral
   binding runs once. The room-model Markdown is returned for the activation
   bootstrap wiring still pending in this draft.

## Risks and mitigations

1. **Two groups consume one setup.** The setup row itself is atomically deleted
   before route creation in the same transaction; only one delete can return it.
2. **A different family receives private setup context.** Candidates must be in
   the live roster, on the exact prepared Murph line, within the short expiry;
   ambiguity does not guess.
3. **An existing group changes owner or style.** Setup application is conditional
   on `ensure.created`; an existing-route convergence restores the claimed row.
4. **Optional corrupt state wedges group admission.** Invalid encrypted payloads
   are not authority and are consumed rather than repeatedly blocking new groups.
5. **Schema turns into a generic draft-group subsystem.** The table owns only one
   short-lived next-group intent per member; it has no group id, chat id, roster,
   lifecycle state machine, or history.
6. **Foreground latency grows unchecked.** The final adapter must make exactly
   one bounded Linq roster call before the transaction, resolve at most 32
   participant members, and retain the existing sender-only fallback on provider
   failure.

## Tasks

1. Land the store, migration, selection rule, composition service, and focused
   unit tests as a reviewable draft foundation.
2. Add private prepare/read/cancel tool actions against the existing group tool.
3. Add bounded pre-transaction roster acquisition and member-id projection.
4. Replace only the new-group owner-resolution branch with the shared prepared
   route service; preserve existing explicit-route handling.
5. Extend thread-container activation with optional initial room-model Markdown
   and initialize the existing fixed page idempotently before first-turn planning.
6. Add PostgreSQL race proof, webhook planner scenarios, privacy/account-deletion
   proof, docs, focused verification, and review gates.

## Decisions

- Prefer one imperfect but explicit "next group" intent over a deterministic
  setup code or a provider-specific actor heuristic.
- Treat roster membership as matching evidence, not ownership by itself. The
  pending intent supplies the ownership claim; the sender resolves only a real
  conflict.
- Preserve the existing first-active-sender behavior whenever no pending setup
  is safely selected.
- Keep this PR draft until the adapter, tool, room-model initialization, and
  production-faithful tests are complete.

## Verification

- Focused local TypeScript syntax and unit-test execution remain pending until
  the draft is materialized in a repository checkout with workspace dependencies.
- Exact-head GitHub Actions are expected to identify schema drift or package
  boundary work still required by the intentionally incomplete draft.
