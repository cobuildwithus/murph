# Persist provider group titles and target joined groups by participants

Status: active
Created: 2026-08-26
Updated: 2026-08-26

## Goal

- Preserve a real Linq/iMessage group title when a hosted group is first
  materialized, and let any current member target one joined group from their
  private Murph by exact title or participant description without exposing or
  persisting participant handles.

## Success criteria

- A newly materialized Linq/iMessage group stores a sanitized provider title
  only on row creation; fake comma-joined handle labels are rejected, existing
  null names remain null, and no historical backfill or rename synchronizer is
  introduced.
- Any current group member can describe an existing joined Linq/iMessage/SMS
  group by its participants. The requester may use only their own active shared
  Contacts projection; group-owner or other-member Contacts are never read.
- Unnamed participants are represented only by closed safe hints: NANP area
  code plus last four, canonical international-phone last four, generic email
  participant, and participant count. Full handles never reach model-visible
  output or new persistence.
- Target selection succeeds only for exactly one complete live candidate.
  Provider failure, deadline, malformed/unsupported roster data, duplicate
  evidence, or ambiguity fails closed before an effect. Missing Contacts names
  fall back to safe masked hints instead of blocking selection.
- Resolution and final membership/route revalidation happen inside the
  existing Web admission for ask or handoff. The model supplies descriptive evidence,
  never an internal member, membership, runtime, thread, route, or reusable
  target-selector id.
- The provider scan uses set-based database reads, bounded provider concurrency,
  one absolute deadline, no provider/KMS work inside a transaction, and a
  Web-owned fail-closed live-scan ceiling independent of the 25-item model
  response budget.
- Deterministic tests, focused typechecks, one real-Codex journey, changelog,
  docs, PR evidence, preliminary specialist review, exact-head final ReviewGPT,
  and required CI complete with no unresolved accepted finding.

## Scope

- In scope: Linq/iMessage/SMS materialization and private-to-joined-group ask or
  handoff targeting; requester-scoped shared Contacts; safe participant hints;
  contract, prompt, test, product-spec, and changelog updates.
- Out of scope: historical backfill, background title rename sync, Telegram
  participant targeting, Telegram creation-title changes, fuzzy matching,
  guessing, fanout, participant identity/profile writes, and contact import.

## Constraints

- Technical constraints: reuse existing group, route, provider-summary,
  address-book, Assistant Ask, notification, and replay owners; add no table,
  queue, service, registry, participant directory, or provider call inside a
  transaction. Keep external/KMS concurrency at four or below and drain all
  started work.
- Product/process constraints: use only the authenticated requester's current
  membership and shared Contacts authority; preserve title-only routing; ask a
  natural clarification on ambiguity; keep the PR draft until focused proof,
  parent review, and the required review gates are ready.

## Risks and mitigations

1. Risk: another member's Contacts or raw provider handles leak into model
   context. Mitigation: requester-bound Contacts lookup, closed safe-summary
   types, strict parsers, and negative privacy tests at every response boundary.
2. Risk: incomplete provider evidence is mistaken for a unique target.
   Mitigation: complete/incomplete aggregate status and all-candidates success
   requirement before participant-derived uniqueness.
3. Risk: target authority changes between description and send. Mitigation:
   resolve descriptions and perform the effect in one Web action, then re-read
   membership and exact route immediately before queueing.
4. Risk: this PR conflicts with the concurrent membership-list-bound change.
   Mitigation: keep the provider-scan ceiling Web-local, prove selection above
   25 memberships, and do not duplicate its presentation cap as authority.
5. Risk: Web, Worker, and warm runner deploy out of order. Mitigation: use an
   additive reader-first wire shape or gate the producer, document rollback
   floor, and verify mixed-version behavior.

## Tasks

1. Extract a pure Linq summary-to-explicit-title helper and thread one
   create-only title through both hosted-group materialization paths.
2. Add a requester-member-scoped Contacts reader and a read-only complete live
   participant-summary resolver with bounded provider fanout.
3. Extend group consult ask/handoff contracts so Web can resolve an exact title
   or participant description and atomically revalidate the selected effect.
4. Update assistant guidance and product/security/reliability owner docs.
5. Add deterministic privacy, ambiguity, max-cardinality, replay, materialization,
   and mixed-version coverage plus one focused real-Codex journey.
6. Add the public changelog record, run focused verification, inspect actual
   assistant replies, and complete the Product UX walkthrough.
7. Commit and push the exact candidate, open the draft PR, run preliminary
   specialist ReviewGPT and final ReviewGPT with CI, remediate accepted
   findings, and hand off the reviewed exact head.

## Decisions

- Participant-based targeting is available to every current member, not only
  the group owner.
- Contacts authority follows the authenticated requester. No request may fall
  back to the group owner or another member's projection.
- Ask/handoff resolves and effects the target in one Web admission; a reusable
  target token is unnecessary and would add replay state without improving the
  authority boundary.
- A provider title is create-only initial metadata. Existing group rows are not
  updated and there is no backfill.

## Verification

- Commands: focused Web/hosted-execution/assistant-engine Vitest slices; Web,
  hosted-execution, and assistant-engine typechecks; focused
  `pnpm test:assistant:live -- --test <pattern>`; changelog coverage; scoped
  docs/architecture drift checks; exact-head GitHub CI; preliminary and final
  ReviewGPT commands required by the completion workflow.
- Expected outcomes: all deterministic checks pass, the printed Murph replies
  select or clarify without leaking handles, proof covers more than 25
  memberships and over-budget failure, PR CI is green, and final ReviewGPT returns a validated
  pass with no unresolved accepted findings.

## Progress and direct evidence

- Implementation and deterministic boundary coverage are complete. The live
  scan uses set reads, four provider/KMS workers, one five-second deadline, a
  fail-closed 100-membership ceiling, and polynomial distinct-person matching.
- Green focused proof: hosted-execution typecheck and 10 contract tests;
  assistant-engine typecheck and 97 group-tool tests; Web prepared typecheck,
  six participant-resolver tests, 318 group/address-book tests, 220 Linq
  onboarding tests, and the isolated stalled-response deadline regression.
- The full Web lint completed with zero errors. Existing repository warnings
  were inspected; the only patch-introduced warning was removed. Agent-docs
  drift passes after indexing the materially updated owner docs.
- The focused real-Codex journey passed. Murph made exactly one handoff call,
  used a participant display-name clue without a group title or handle, and
  truthfully replied that the handoff was queued.

## Product UX walkthrough

1. New named Linq group: the sanitized real provider title is stored only on
   group-row creation; an existing row is not renamed. Synthesized handle
   rosters, malformed metadata, direct chats, and handle-bearing titles remain
   unnamed.
2. Current member with shared Contacts: owner and non-owner members use the same
   membership path, and selection reads only the requester's projection. A
   deterministic 26-membership journey selects the one matching contact name.
3. Current member without shared Contacts: safe descriptions use participant
   count, NANP area code plus last four, international last four, or generic
   email participant. Full handles do not enter the assistant contract or new
   persistence.
4. Ambiguous, incomplete, missing, malformed, timed-out, or oversized evidence:
   the action fails closed or returns bounded safe clarification descriptions;
   no first/newest/role-based guess, fanout, or partial-candidate uniqueness is
   allowed.
5. Replay and authority change: normalized participant evidence is digest-bound
   to the stored wake, while current requester membership and the exact selected
   route are revalidated immediately before append. Changed evidence conflicts;
   removed membership or a rebound route cannot effect the old selection.
6. Unchanged surfaces: title-only selection remains available, historical rows
   are not backfilled, provider renames are not synchronized, and Telegram is
   outside participant targeting and creation-title persistence.
