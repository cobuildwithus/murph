# Linq Group Chat Auto-Provision

## Goal

Make group chats work self-serve: when an iMessage (Linq) group message arrives with no
existing thread route, and the sender is an active hosted member texting their own home
Murph line, automatically provision the dedicated thread-container runtime and route the
triggering message into it. Delete the operator-only thread-route form and API since the
webhook path replaces them.

## Success Criteria

- A group message from an active member on their home line creates the
  `HostedThreadContainer` + `HostedThreadRoute` via the existing
  `ensureHostedThreadContainerRouteTx` primitive and delivers that same message to the new
  container runtime (Murph replies to the first message).
- Group messages from non-members, inactive/suspended members, senders on someone else's
  line, or with `is_group` unattested keep being ignored (fail closed).
- Second and later messages take the existing explicit-thread-route path unchanged.
- `/api/ops/thread-routes` and the runtime-maintenance "Add Linq groupchat route" form are
  removed; `ensureHostedThreadContainerRouteTx` remains the single provisioning primitive.
- Direct-thread onboarding, home-thread rebind attestation guard, and membership-vs-data
  sharing invariants are untouched.

## Constraints

- Utmost priority: clean, simple, composable, minimal-complexity architecture. Reuse the
  existing planner guards, lookups, and the ensure primitive; no new state, tables,
  managers, or queues.
- Owner gating matches the primitive: `hasHostedMemberActiveAccess` (plain active), and the
  recipient line must be the sender's sticky home line (`HostedMemberRouting.linqRecipientPhone`),
  because Linq lines are pooled and line→member is not unique.
- Murph never sends the first message into a thread; provisioning only happens on an
  inbound message from the owning member (deliverability + anti-abuse posture).
- No per-owner container count cap in this change; the per-container monthly usage cap and
  owner-active gating bound the cost. Revisit only with observed abuse.

## Design

In `planHostedOnboardingLinqWebhook`, replace the unconditional `ignored-group-chat` branch
with a delegated `planHostedLinqGroupChatWebhook` that:

1. Ignores when: `isFromMe`, empty parts, missing participant contact, local inbound guard.
2. Resolves the sender via the existing phone-identity / verified-email lookups.
3. Ignores when: no member, suspended, not plain-active, no home Linq route, or normalized
   home recipient phone != normalized incoming recipient phone.
4. Calls `ensureHostedThreadContainerRouteTx` (owner = sender, channel `linq`,
   threadId = chat id, account keys from the recipient phone). Pre-write
   `hostedOnboardingError`s (`ALREADY_BOUND`, owner gates) map to an ignore plan.
5. Re-reads the route snapshot and falls through to `planHostedLinqExplicitThreadRouteWebhook`
   so the triggering message is appended and the post-commit wake handoff drains both the
   activation envelope and the conversation wake from the container mailbox.

## Verification Plan

- Extend `apps/web/test/hosted-onboarding-linq-thread-route.test.ts` (or a sibling focused
  file) with planner-level cases: provision+route on member-on-home-line first message;
  non-member ignored; inactive member ignored; wrong-line ignored; `is_group` undefined
  unaffected; suspended ignored; second message routes without re-provisioning.
- Remove `/api/ops/thread-routes` coverage from `hosted-runtime-maintenance-ops.test.ts`.
- `pnpm typecheck`, focused web tests, `pnpm test:diff` on touched paths.

## State

Implemented and verified: planner group branch delegates to
`planHostedLinqGroupChatWebhook`; ops thread-route API/form and the unused
non-Tx ensure wrapper are deleted; focused planner/dispatch/ops tests plus the
full `pnpm test:diff` apps/web verify lane (3515 tests, typecheck, build) are
green. Non-members in a provisioned group route through the existing
explicit-thread-route path (no membership check after provisioning).
Status: completed
Updated: 2026-07-02
Completed: 2026-07-02
