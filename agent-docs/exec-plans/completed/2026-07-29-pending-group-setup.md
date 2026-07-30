# Prepare the next Murph group

Status: completed
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
- A lone roster-matched prepared member owns and initializes the new synthetic
  group runtime even when another participant, including a person without their
  own Murph account, sends the first message.
- With several candidates, the sender's setup wins only when the sender owns one;
  otherwise no setup is guessed and the existing sender-owner fallback remains.
- One setup can initialize at most one newly created route under concurrent
  first messages or simultaneous new groups.
- Group style reuses the existing synthetic member preference owner. Qualitative
  context initializes the existing fixed group room-model page; there is no
  second prompt or preference store.
- Existing routes never consume a pending setup or change owner, style, or room
  context.

## Scope

- Private-text `murph.group` actions to prepare, read, and cancel one setup.
- A strict versioned payload containing sparse existing style settings and an
  optional bounded room-context Markdown seed.
- One encrypted Postgres row per member with owner, blinded line key, encrypted
  payload, and times.
- One bounded provider roster read before an unbound-group transaction.
- Bounded roster-handle resolution to known member ids.
- Deterministic candidate selection and atomic one-use claim.
- Composition over the existing thread-container, preference, room-model, and
  usage-referral owners.
- Focused unit, webhook, schema/privacy, and PostgreSQL concurrency proof.
- Durable architecture, security, reliability, product, skill, and testing-map
  documentation.

## Constraints

- `HostedThreadContainer.ownerMemberId` remains the only canonical group owner.
- The synthetic thread-container member remains the only group style owner.
- The existing fixed group room-model page remains the only durable room-context
  surface.
- The provider adapter passes only resolved member ids into the transaction;
  raw roster handles are never persisted in setup state.
- `participant.added` actor data is not authority.
- Provider I/O stays outside the database transaction and is bounded.
- No cleanup scheduler: expiry is query-time authority; replacement,
  cancellation, claim, and member deletion remove state.
- No generalized draft-group subsystem, provisional owner, reassignment path,
  or second provider abstraction.

## Design

1. A fresh private text turn arms one setup for the active person's current
   managed Linq line; a newer setup atomically replaces the older one.
2. The encrypted v1 payload contains only sparse existing style settings and an
   optional bounded Markdown seed for the fixed group room model.
3. Before the first inbound for an unbound Linq group, Web performs one bounded
   current-chat read and resolves at most 32 active non-Murph handles to member
   ids. On roster failure, an active authenticated sender remains exact
   participant evidence for their own setup; an unregistered first speaker is
   rejected with a retryable response before durable acceptance so the original
   provider webhook can be replayed after recovery.
4. Inside the route transaction, candidate selection is:
   - one candidate: select it;
   - several candidates and sender owns one: select the sender's;
   - otherwise: select none.
5. `DELETE ... RETURNING` claims the selected setup exactly once. A concurrent
   claimant re-evaluates without it.
6. The selected setup owner, or the existing active-sender fallback, is passed
   to `ensureHostedThreadContainerRouteTx`. A uniquely selected setup does not
   require the first speaker to be a registered Murph member. The canonical
   route primitive remains the only route and owner writer.
7. On a newly created route, style is applied through the existing hosted-member
   preference mutation owner, the activation event carries the optional initial
   room-model Markdown, and the existing usage-referral binding runs once. The
   hosted runtime treats room-model initialization as a required system-mailbox
   action before the first conversation turn; failure requeues the action and
   defers the reply.
8. An existing-route convergence or recoverable admission failure restores the
   still-valid setup; a successful new route consumes it.

## Risks and mitigations

1. **Two groups consume one setup.** One transactional delete is the
   linearization point; the opt-in PostgreSQL test races two claimants.
2. **A different room receives private context.** Candidates must be in the live
   roster, on the exact prepared Murph line, and inside the short expiry;
   ambiguity never guesses.
3. **Stale or incomplete provider roster.** The lookup is advisory matching
   evidence only. An active sender can still prove their own participation; an
   unregistered first speaker receives a retryable pre-acceptance failure so
   recovery does not silently lose their original message or prepared owner.
4. **Existing ownership or configuration changes.** Setup application is
   conditional on a newly created route; existing-route convergence restores the
   claim.
5. **Corrupt optional payload wedges group admission.** Invalid encrypted state
   is not authority and terminates as an unavailable setup instead of repeatedly
   blocking unrelated group replies.
6. **Foreground latency grows.** The provider call is one non-retried 1.5-second
   read before the transaction and resolution is capped at 32 handles.
7. **Setup becomes a second room profile.** Numeric behavior stays in existing
   preferences and qualitative context is written once to the existing room
   model; the pending row is deleted after binding.
8. **An unregistered first speaker defeats the prepared owner.** New-group
   admission resolves the sender when possible but consults the pending roster
   setup before requiring an active sender; a focused regression proves the
   parent-prepares/child-speaks-first path while the no-setup fallback remains
   unchanged.
9. **The first reply races explicit room context.** Initialization is a required
   pre-conversation mailbox action. A failed seed is requeued without invoking
   the assistant, and replay initializes the fixed room-model page before the
   original accepted message receives its first reply.

## Tasks

1. [x] Land the ownership intent, roster matching, one-use claim, canonical route
   composition, and focused concurrency foundation.
2. [x] Add private prepare/read/cancel tool actions and fresh-private-text gating.
3. [x] Restore the encrypted sparse style/context payload to those existing
   actions and response contracts.
4. [x] Apply style through the synthetic member preference owner on new-route
   creation only.
5. [x] Extend thread-container activation with optional initial room-model
   Markdown and initialize the existing fixed page idempotently before the first
   conversation turn.
6. [x] Complete webhook scenarios, payload/privacy/account-deletion proof, and
   production-faithful activation/replay coverage.
7. [x] Reconcile current `main`, remove temporary source/repair scaffolding, fix
   the unregistered first-speaker admission and roster-recovery paths, require
   room-context initialization before first reply, and run focused verification.
8. [x] Complete preliminary specialist review and resolve its accepted coverage
   and prompt-contract findings.
9. [x] Complete parent final review, final focused verification, and the
   immutable exact-head handoff to concurrent CI and final ReviewGPT.

## Decisions

- Prefer one explicit short-lived setup over an add-actor heuristic, roster
  ordering, timing inference, or pending-owner state machine.
- Treat roster membership as matching evidence, not ownership. The private
  member setup supplies the ownership claim.
- Keep structured style and qualitative room context in their existing owners;
  pending setup is only a one-shot transfer envelope.
- Preserve existing first-active-sender behavior whenever no setup can be
  selected safely.
- Keep this scope distinct from open Linq group work: line recovery, line/chat
  health, and participant display-name presentation reuse neighboring owners
  but do not own pending setup or roster-matched ownership transfer.
- Keep the PR draft until the full configured-group behavior and exact-head gates
  are complete.

## Verification

- Focused Web, hosted-execution, assistant-engine, assistant-runtime, migration,
  privacy, and PostgreSQL race/restore proof is recorded in the PR.
- The configured payload, activation contract, room-model replay, secret-safe
  runtime handling, and corruption/deletion behavior pass the focused suites.
- The repaired planner has direct regression coverage for a uniquely prepared
  roster owner when an unregistered participant sends the first message, plus
  the unchanged no-setup non-member rejection case.
- Provider-roster failure coverage proves an unregistered first speaker is not
  claimed or durably appended, and that provider replay after recovery appends
  the original message once under the prepared owner.
- Runtime replay coverage proves failed room-context initialization invokes no
  assistant turn and that the retry initializes the fixed page before exactly
  one reply attempt.
- Runner-bundle assembly was re-baselined to the exact measured feature head
  without admitting a forbidden boot subsystem, and Web source aliases include
  the new hosted-execution subpath.
- After reconciling current `main`, hosted-execution, assistant-engine,
  assistant-runtime, and Web typechecks pass. Conflict-focused Cloudflare,
  Web, and assistant-engine suites pass, including 34 runner-bundle tests and
  69 dynamic group-tool tests.
- The required product-experience review found two blocking recovery/ordering
  gaps; both were corrected with the focused replay proofs above.
- Preliminary specialist ReviewGPT found two valid gaps: exact-expiry authority
  lacked real PostgreSQL proof, and the model schema presented a byte limit as
  character `maxLength`. The isolated database suite now proves read/claim
  expiry at the exact boundary, while the model contract uses a conservative
  512-code-point cap inside the unchanged authoritative 2 KiB UTF-8 envelope
  with multibyte parser coverage.
- Broad exact-head CI exposed an unconditional dependency-construction call in
  the required room-model prephase. The prephase now probes the existing
  mailbox owner first and creates execution dependencies only for due work; the
  full 266-test workspace-phase file passes.
- An open-PR title/body/file audit found no duplicate pending-group
  implementation. The nearest overlapping PRs own line recovery (#1122),
  line/chat health (#1118), and participant display names (#1133); their shared
  hot files remain a reconciliation concern, not a reason for a second setup
  architecture.
- Parent final review found that successful new-group admission fetched the
  canonical Linq roster and then fetched the same chat again during post-commit
  participant reconciliation. The canonical handles now remain request-local
  and flow into the existing reconciliation owner, preserving the provider
  outage fallback while keeping the successful hot path to one provider call.
  All 92 Linq thread-route tests and the Web typecheck pass.
- The final candidate merged the latest base update, which was confined to the
  distinct R2 live-copy surface. The 92 Linq thread-route tests and Web
  typecheck pass again on that reconciled head.
- Preliminary specialist and parent final reviews are complete. Exact-head CI,
  final ReviewGPT, and final merge proof now own the remaining PR readiness
  gate outside this completed implementation plan.
Completed: 2026-07-29
