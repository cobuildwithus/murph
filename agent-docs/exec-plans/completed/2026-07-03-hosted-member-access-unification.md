# Hosted Member Access Unification

## Why

July 3 incident: the first live iMessage group chat was silently dropped because the linq
group-chat webhook gates use the family-blind `hasHostedMemberActiveAccess` (member-level
`billing_status === active`) while the sender was family-sponsored (`billing_status =
not_started`, access derived from the account group). A four-agent architecture review found
"does this member have access" has three parallel representations (own billing status, family
read-time derivation, container owner-join), two predicates where picking the wrong one is
silent, and five family-blind gates — all on the thread-container path.

## Decision

Collapse to one primitive. `hosted_member.billing_status` means the member's OWN Stripe
relationship only (already true; container creation stops writing a fake `active`). Sponsorship
stays derived from the edges that already exist (`hosted_account_group_membership`,
`hosted_thread_container.owner_member_id`). One new module owns the derivation:

- `apps/web/src/lib/hosted-onboarding/member-access.ts`
  - `hostedMemberAccessSelect` (canonical Prisma select fragment)
  - `hasActiveHostedMemberAccess(shape)` pure: suspended -> false; thread-container member ->
    owner access only (own status ignored); person -> own billing active OR active membership
    in an active, unsuspended group. Depth <= 2 (owners cannot be containers).
  - `readActiveHostedMemberAccess({memberId, prisma})`, `assertActiveHostedMemberAccessAllowed`
  - `hasActiveHostedThreadContainerAccess({container, owner})` for route/egress/usage gates.

Deleted: `hasHostedMemberEffectiveActiveAccess(ForMember)`, `assertHostedMemberEffectiveActiveAccessAllowed`,
`hasActiveHostedFamilyAccess`, the `familyAccessActive` parameter threading through
entitlement/member-activation/lifecycle, and the read-time seat re-check inside
`readHostedFamilyAccessForMember` (proven unreachable; the write-time subscription webhook
already fails the group to `unpaid` on seat overage — the product-spec fail-closed contract is
preserved at write time). `hasHostedMemberActiveAccess` is renamed to
`hasHostedMemberOwnActiveBilling` (assert variant likewise) so billing surfaces state their
real intent and no future gate can grab the family-blind check by accident.

Family-blind gates fixed by adoption: linq group sender gate + explicit-route gate,
thread-container owner gate, thread-route egress authority, runtime-access owner limb,
usage-allowance owner gate, group-tool participant-membership check.

## Invariants preserved

- Family entitlement contract in `agent-docs/product-specs/hosted-family-plan.md` (derived
  sponsored access, fail closed on group inactive/removed/seat overage via write-time
  enforcement).
- Product-critical flow preservation: family-sponsored members gain (not lose) authorized
  paths; solo members unchanged; billing mutation surfaces keep own-subscription semantics.
- No schema change; no data backfill required (prod `hosted_thread_route`/containers are
  empty; existing vestigial container `active` rows would be ignored by the resolver anyway).

## Consciously rejected

- Materializing sponsored access into `hosted_member.billing_status`: the revocation sweep would
  need the derivation logic anyway (container owners can be family-sponsored), and a dozen
  billing/onboarding surfaces key on the raw status.
- Partial unique index enforcing one active membership per member: not representable in
  schema.prisma, so it would fight `prisma migrate` drift detection; the write-time asserts plus
  member row locks already hold the invariant.

## Verification

Owner coverage for `apps/web` hosted-onboarding/routing/mailbox/execution tests + typecheck;
new regressions: family-sponsored sender provisions a group thread; family-aware egress and
runtime gates; container member created `not_started`.
Status: completed
Updated: 2026-07-03
Completed: 2026-07-03
