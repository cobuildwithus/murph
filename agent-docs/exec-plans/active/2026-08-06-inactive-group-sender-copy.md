# Inactive group-sender recovery copy

Status: active
Created: 2026-08-06
Updated: 2026-08-06

## Goal

- Make the first group reply accurately tell a recognized sender when their
  Murph access is inactive instead of saying they still need to set up Murph.
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

## Success criteria

- A recognized sender without active access receives copy addressed to that
  sender, not copy claiming that somebody still needs to finish initial setup.
- Every inactive-sender variant states both recovery paths: an active Murph
  participant can message in the group, or someone can open the group-start
  link.
- The unknown-sender setup behavior remains unchanged.
- Variant selection is deterministic for retries and rotates across distinct
  group/day effect identities.
- The message remains one reply with one full first-party URL and exposes no
  billing reason or other private account detail to the group.

## Scope

- Fresh Linq group setup planning and payload metadata.
- Group setup message rendering and deterministic copy variants.
- Focused unit and route/dispatch regression tests.

## Constraints

- Keep current-sender authority; do not borrow another roster participant's
  access before that participant sends a message.
- Keep the existing one-offer-per-group-per-inbound-UTC-day identity.
- Add no schema, queue, scheduler, dependency, or new delivery owner.
- Do not include real user feedback, phone numbers, member IDs, or transcript
  wording in repository artifacts.

## Tasks

1. [x] Add a reason-bearing group-setup payload and reviewed inactive-sender
   variants.
2. [x] Add focused rendering, planner, and dispatch coverage.
3. [x] Run scoped tests, typecheck, diff checks, and identifier review.
4. [ ] Push the exact candidate and complete the required specialist review and
   exact-head CI.
5. [ ] Close this plan through the scoped final commit.

## Verification log

- Focused Linq group setup, route-planning, and transport suite passed: 209
  tests in three files.
- Hosted Web TypeScript check passed after generating the standard ignored
  Prisma and Health Commons build inputs in the fresh task worktree.
- Scoped ESLint passed across all changed source and test files.
- `git diff --check` passed.
