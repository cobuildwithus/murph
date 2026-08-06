# Inactive group-sender recovery copy

Status: active
Created: 2026-08-06
Updated: 2026-08-06

## Goal

- Make the first group reply explain that Murph cannot start from that message
  without disclosing the sender's account state to the room.
- Send the recognized inactive sender's specific recovery explanation only to
  their existing re-attested private Murph thread.
- Tell the group that a participant with active Murph access can message next,
  while retaining the existing group-start link as the alternate recovery path.
- Rotate across many reviewed variants without changing sender authority,
  provisioning, deduplication, delivery, or retry ownership.

## Root-cause evidence

- The fresh-group planner resolves and access-checks the current sender.
- Unknown senders and recognized senders without active access currently share
  the same `group_setup` payload and static message.
- Production evidence proved that a recognized, configured sender with lapsed
  access entered that branch; an active participant's next inbound then
  provisioned the group normally.
- The first candidate put the inactive-versus-unresolved reason inside the
  request-local payload while keeping one group/day provider identity. A stale
  retry could therefore reuse one provider key for two different room bodies.
  The final design removes that incongruent intent and renders one canonical
  neutral body from the stable effect identity.

## Success criteria

- A recognized sender without active access receives account-specific recovery
  only through a matching, re-attested private route.
- Every inactive-sender room variant states both recovery paths: an active
  Murph participant can message in the group, or someone can open the
  group-start link.
- Unknown and inactive senders share the same canonical account-neutral room
  body; unknown-sender admission and provisioning behavior remains unchanged.
- Variant selection is deterministic for retries and rotates across distinct
  group/day effect identities.
- The room's existing logical setup delivery retains one full first-party URL
  and exposes no sender, billing, trial, subscription, or other private account
  detail.

## Scope

- Fresh Linq group setup planning and payload metadata.
- Group setup message rendering and deterministic copy variants.
- Existing re-attested private Linq recovery routing.
- Focused unit and route/dispatch regression tests.

## Constraints

- Keep current-sender authority; do not borrow another roster participant's
  access before that participant sends a message.
- Keep the existing one-offer-per-group-per-inbound-UTC-day identity.
- Key private recovery to that group/day identity, member, and resolved
  recovery kind so distinct webhook attempts cannot repeat it.
- Add no schema, queue, scheduler, dependency, or new delivery owner.
- Do not include real user feedback, phone numbers, member IDs, or transcript
  wording in repository artifacts.

## Tasks

1. [x] Add reviewed canonical account-neutral group-setup variants.
2. [x] Add focused rendering, planner, and dispatch coverage.
3. [x] Run scoped tests, typecheck, diff checks, and identifier review.
4. [ ] Push the exact candidate and complete the required specialist review and
   exact-head CI.
5. [ ] Close this plan through the scoped final commit.

## Verification log

- Focused Linq group setup, route-planning, and transport suite passed: 209
  tests in three files.
- After specialist privacy remediation, the focused group setup, route,
  transport, and visible-secondary recovery suite passed: 230 tests in four
  files.
- After final-round ordering and idempotency remediation, five focused planner,
  dispatch, transport, rendering, and private-recovery suites passed: 395
  tests. Coverage proves stable same-day private identity, next-day and changed-
  recovery separation, and retry-before-private behavior while room setup is in
  flight.
- The substantive round-3 review found that one group/day effect could render
  two different bodies after sender resolution changed. The redesign deleted
  the reason-bearing payload and dual-body branch, retained one canonical
  50-variant renderer keyed only by the effect identity, and made terminally
  unavailable room setup fail closed before private recovery. The same five
  focused suites passed afterward: 397 tests.
- Hosted Web TypeScript check passed after generating the standard ignored
  Prisma and Health Commons build inputs in the fresh task worktree.
- Scoped ESLint passed across all changed source and test files after the
  privacy remediation.
- `git diff --check` passed.
