# Minimal private group self-leave

Status: completed
Created: 2026-07-15
Updated: 2026-07-15

## Goal

- Let a non-owner leave one of their own hosted group memberships either by
  asking their private Murph or from the authenticated existing-member state on
  that group's join page, without importing the group-chat sender, lifecycle,
  replay, and inactive-runtime machinery from PR #558.

## Success criteria

- `list_memberships` returns the callback member's own opaque membership ids and
  private Murph can call `leave_membership` with one returned selector. Web
  always binds the actor to the signed callback member; foreign or stale
  selectors reveal nothing and cannot affect another member.
- An authenticated existing non-owner can leave from the existing group join
  page. The join code selects the group while the app session selects the actor;
  owner, nonmember, missing-auth, and cross-origin attempts fail closed.
- One transaction rejects the canonical owner, revokes every active share from
  the participant to the group runtime with durable cleanup envelopes, and
  deletes the membership row. Repeating the action is safe.
- User-facing guidance states the boundary honestly: Murph membership and
  future sharing end, but iMessage membership and historical/provider copies
  are not removed.
- Focused tests, routed diff verification, the required coverage audit, parent
  final review, exact-head CI, and ReviewGPT complete with no unresolved
  actionable findings.

## Scope

- In scope: the existing personal membership list, a selector-bound group tool
  mutation, the join page/client and one authenticated leave route, the Web
  group store transaction, focused tests, and the existing group-awareness
  product contract.
- Out of scope: group-chat leave commands or sender inference, exposing reusable
  join links to ordinary members, inactive-runtime interception, schema
  migrations, membership tombstones or epochs, new mailbox states, queued-output
  cancellation, replay frameworks, and provider-level iMessage removal.

## Constraints

- Keep row presence as the sole hosted group membership truth.
- Reuse the existing signed group callback, authenticated join-page session and
  same-origin guard, vault share revocation owner, durable cleanup envelope, and
  generic Cloudflare port.
- Do not require the departing participant's billing/runtime access to remain
  active; withdrawal must fail closed on authority, not on subscription state.
- Preserve the owner membership and every unrelated working-tree change.

## Tasks

1. Add the private membership action contract and assistant-facing guidance.
2. Implement selector-bound private-tool and join-page leave paths over one
   atomic store transaction.
3. Add focused contract, Web owner, route, client, page, and assistant tests.
4. Run scoped verification, coverage review, and parent final review.
5. Finish the scoped commit, open the replacement PR, run CI and ReviewGPT, then
   close PR #558 with a pointer to the replacement.

## Verification

- Focused tests for every touched owner plus owning package typechecks.
- `pnpm test:diff` for the complete touched source/test/doc slice.
- Coverage-write audit, parent final diff review, `git diff --check`, and
  privacy/identifier scan before commit.
- Exact pushed-head CI and ReviewGPT on the replacement PR.

## Decisions

- Hard-delete membership rather than adding `leftAt`; all current readers
  already treat row presence as membership and a later explicit join creates a
  fresh membership row.
- Keep private Murph from disclosing ordinary members' reusable join links;
  `membershipId` is an opaque selector and never mutation authority.
- Accept the bounded v1 limitation that already-accepted group output can still
  arrive once. Cancelling it requires lifecycle machinery deliberately excluded
  from this replacement.
- Hard delete deliberately preserves the existing join behavior: a delayed
  affirmative reaction that the current join system accepts can create a fresh
  membership. Fencing provider replay requires the epochs and lifecycle state
  deliberately excluded here.
Completed: 2026-07-15
