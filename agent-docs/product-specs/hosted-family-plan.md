# Hosted Family Plan

Last verified: 2026-06-18

## Purpose

Hosted Family is the fixed-seat billing and access layer for inviting close
family members into Murph without making them manage Stripe checkout. It should
feel like Spotify Family for access, but keep Signal-style privacy for health
data and conversations.

The MVP supports one owner plus up to three invited family members, for four
people total.

## Product Contract

- One owner pays for the hosted Family plan.
- Family members receive sponsored hosted access while the plan and their
  membership are active.
- Every family member remains a separate `HostedMember` with their own routing,
  mailbox, workspace/runtime state, legal consent, export, and deletion rights.
- The owner can see seat and setup status, such as invited, joined, messaging
  connected, or removed.
- The owner cannot see family members' private messages, vault data, wearable
  data, mailbox content, outcome cards, runtime logs, or browser-vault exports.
- Removing a family member revokes sponsored access only. It does not delete
  the member's account, historical data, consent history, routing rows, or
  export/delete rights.

Family membership is an entitlement source, not a data-sharing relationship.

## Non-Goals

Do not add in the MVP:

- shared family health dashboard
- family-owner access to raw or summarized health data
- child/minor accounts or parental health-data authority
- variable seat quantities, per-seat billing, proration, or mid-cycle billing
  schedules
- family-level mailbox, shared assistant runtime, or shared vault
- automatic challenge sharing

Sharing health data belongs to future scoped challenge consent. Family plan
membership alone must not grant health-data sharing.

## Seats And Billing

The MVP Family plan is fixed at four people total:

- one owner
- up to three active or invited family members

The hosted billing plan registry should add a Family plan code for the fixed
plan. Stripe owns the subscription, invoices, payment method, and renewal
state. Murph stores only the hosted read model needed for entitlement,
settings display, and reconciliation.

The first version should not introduce generic plan-transition machinery. Family
checkout activates or reconciles the owner's family group; direct Pulse and Edge
billing continue to use the existing member billing path.

## Data Ownership

Hosted Family state lives in `apps/web` Postgres as hosted product/control
state. It is not canonical local-vault health truth.

The clean model is:

- `HostedAccountGroup`: the family group and owner.
- `HostedAccountGroupMembership`: one member's role and access state in the
  group.
- `HostedAccountGroupInvite`: a scoped invite into the group.
- `HostedAccountGroupBillingRef`: the Stripe-derived read model for the family
  subscription.

Use account-group naming in code where practical so product-facing "Family"
does not collide with existing vault `family` record families.

## Entitlement

A hosted member has active access when either:

- their existing direct hosted billing status grants access, or
- they have an active family membership in an active family group whose billing
  state grants access.

Sponsored access must fail closed when:

- the family subscription is canceled, unpaid, paused, suspended, or otherwise
  inactive,
- the member is removed from the group,
- the group is over the fixed-seat limit,
- the membership is not accepted/active, or
- required launch/legal consent is missing at the boundary that requires it.

Privacy access for export and deletion must remain available under the existing
privacy rules even after sponsored access is revoked.

## Invite Issuance

The owner can issue family invites from the web settings surface and through the
normal Murph assistant channel. Chat issuance should support requests like:

```text
invite my mom, her phone number is +48..., her Telegram is @...
```

The assistant should resolve the request into a bounded invite command owned by
hosted web. The command should create or reuse a scoped family invite while
respecting the four-person seat cap.

Accepted invite targets:

- phone number for WhatsApp or phone-bound flows
- Telegram username as a human hint only
- optional display label such as "Mom" for owner-facing seat status

Do not treat a Telegram username as identity proof. Usernames can change and a
bot generally cannot initiate a private chat with an arbitrary username unless
that Telegram account has already started the bot or is otherwise known.

## Invite Acceptance

The simplest acceptance path should be chat-first.

### Telegram

Telegram invites use a deep link such as:

```text
https://t.me/<bot>?start=<family-invite-token>
```

The hard binding is the Telegram user/chat identity observed when the invitee
clicks the deep link and starts the bot, or an already-known Telegram route.
The Telegram username supplied by the owner remains a display/hint field only.

### WhatsApp / Phone

Phone pre-bound invites may be accepted in chat when the response arrives from
the invited phone number and the WhatsApp messaging consent path has been
completed. For the MVP, the inbound family invite token is the WhatsApp
consent-writing command for that phone-bound acceptance. The accepted member
still gets their own `HostedMember` and routing rows.

### Web Fallback

Web remains a fallback for unsupported verification, settings, wearable
connection, export, deletion, and other account management tasks. The family
MVP should not require a web visit for a straightforward Telegram or WhatsApp
invite acceptance.

## Acceptance Copy

Invite acceptance must explicitly state:

- who invited the person,
- that the owner pays for hosted access,
- that the invitee gets a private Murph account, and
- that the owner cannot see private messages or health data.

Keep the copy plain and non-promotional. Example:

```text
Wojtek invited you to Murph Family. Wojtek pays for access, but your Murph
messages and health data stay private to you. Join?
```

The implementation should render the inviter name from stored display context
when available and fall back to "your family plan owner" when not.

## Removal

Owner removal should:

- mark the membership removed,
- revoke sponsored entitlement,
- leave the member's account and data intact,
- keep privacy export/delete paths available, and
- avoid sending automatic health-context messages outside the normal
  AI-gated or reviewed product-copy surfaces.

The removed member may later start their own direct paid plan through the
existing billing path.

## Export And Deletion

Hosted account export and deletion must include enough family metadata to
explain access state without leaking other members' private data.

An owner's export may include:

- group id/status,
- role,
- seat count,
- invite metadata without active invite tokens,
- membership status rows with minimized display labels.

A member's export may include:

- their own membership status,
- owner/group display context needed to explain sponsored access.

Exports must not include other members' contact lookup keys, raw phone numbers,
Telegram ids, private routing ids, mailbox payloads, health data, or runtime
state.

Deleting a member removes their membership row by cascade or explicit cleanup
but must not delete the family group unless they are the owner and the product
has a documented owner-deletion policy. The MVP should fail closed and direct
owner deletion through the existing account deletion flow plus explicit family
billing cancellation/transfer policy rather than silently orphaning sponsored
access.

## Privacy And Security Invariants

- Family ownership never implies read access to another member's private data.
- Invite tokens are scoped, expiring capabilities and must not be logged or
  exported while active.
- Contact values are encrypted/blind-indexed following existing hosted contact
  privacy patterns.
- Messaging provider credentials remain Worker/provider owned; hosted runtime
  receives no raw provider secrets.
- Family entitlement checks should be explicit and test-covered at access
  boundaries instead of inferred from unrelated billing status.

## Implementation Phases

1. Add the spec, data model, store helpers, and entitlement tests.
2. Add fixed Family billing plan checkout/reconciliation for the owner group.
3. Add invite issuance and acceptance primitives for web/assistant-owned
   commands.
4. Add Telegram deep-link and WhatsApp/phone pre-bound acceptance flows.
5. Add the smallest owner-facing management UI needed to invite/remove members.
6. Add export/delete coverage and direct privacy proof.

Each phase should preserve the existing HostedMember boundary and avoid adding
generic account-management abstractions before the fixed four-person plan proves
insufficient.
