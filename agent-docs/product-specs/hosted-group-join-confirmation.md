# Hosted Group Join Confirmation

Last verified: 2026-07-11
Status: Implemented

## User behavior

When a member first joins a hosted Murph group, Murph follows up in that
member's private account. The message says that they joined the group, asks
whether they meant to, invites a simple yes or no reply, and includes the
existing group join page so they can review or change what they share.

This applies to both supported join paths:

- accepting a disclosed group offer by reacting in the group chat
- accepting through `/groups/join/[joinCode]`

The confirmation is created only when the shared join transaction creates a
new `HostedGroupMember`. A repeated reaction, retried request, or existing
member's sharing edit does not create another confirmation.

## Locked boundaries

- The message goes only to the joining member's persisted private Linq thread
  or private Telegram thread. It is never sent into the group conversation.
- A Linq home route persists the blinded participant kind and lookup key that
  established the thread. Private notifications and subsequent inbound turns
  therefore derive the same conversation identity even if the member later
  adds another account credential. The raw participant value is not added to
  the home-route row.
- Verified member identity remains authoritative when it matches an inbound
  participant. Without verified identity, the incoming chat's canonical home
  owner takes precedence over any provisional pending-contact claim; a
  verified identity that conflicts with the canonical home owner still fails
  closed.
- Inbound home-route decisions and every home mutation share the same
  transaction-scoped per-member lock. Operations that can assign line capacity
  take locks in recipient-pool, member, then chat order and re-read durable
  routing after the required locks before binding or redirecting.
- Family invite acceptance resolves and binds its Linq home route only after
  locking the accepted member row. The accepted route is written once inside
  that lock boundary before the invite claim. Replaying an already accepted
  token returns the existing membership without running the binding callback
  again; there is no unlocked preflight or second post-accept binding pass.
- Replacing another member's provisional pending route takes that member's
  route lock without waiting. A busy owner makes the inbound attempt retry
  instead of clearing concurrent state, and superseding pending state never
  clears the owner's assigned home line.
- Canonical group demotion locks every affected member route in stable order
  before the chat lock, re-reads the owners, and clears the home participant
  authority together with the home chat. A newly appearing owner makes the
  demotion retry rather than mutating a route it did not lock.
- A final home-route egress check takes the member route lock before the chat
  lock and records the provider-dispatch fence in that same transaction. A
  concurrent rehome therefore cannot revoke the checked chat between the
  authority read and dispatch claim. Participant delivery and external-thread
  authority keep their independent owner boundaries.
- Existing Linq rows without that observed participant authority are not
  paired with a later phone or email credential. The confirmation uses an
  existing Telegram thread when available; otherwise that attempt is skipped
  rather than writing the message into the wrong assistant conversation.
- This flow does not use Linq participant-target delivery and therefore cannot
  start a new outbound iMessage conversation. If no private route exists, the
  join still succeeds and no confirmation is created.
- Generic Family and phone-result notifications follow the same persisted-chat
  rule. Only the activation welcome path may use the member's persisted
  participant authority to start its one intentional welcome conversation.
- The link is a full first-party URL built from the canonical hosted web origin
  and the group's opaque join code. If no canonical public origin is
  configured, the join still succeeds and no confirmation is created.
- The existing join page edits the requested sharing set. It is not a
  leave-group control, so the message must not claim that the link or a reply
  removes membership.
- A yes/no reply continues as a normal private conversation. This feature does
  not add a group-leave mutation or infer an undo from reaction removal.

## Messaging contract

The server renders one short, calm, private message that asks the member a
genuine yes/no question and uses the full link once. Owner-controlled group
names never enter model instructions. The copy avoids alert, signup, and
acquisition framing.

Delivery uses the existing `assistant.notification.requested` contract with:

- `responsePolicy: require_send_exact_text`
- `deliveryDispatchMode: queue-only`
- one membership-derived key shared by the mailbox event, delivery dedupe
  token, and delivery idempotency key

There is no group-specific mailbox kind, scheduler, retry queue, or new runtime
consumer.

## Durability and failure behavior

For activated members, membership, grants, revokes, and the confirmation
mailbox item share one Prisma transaction. If a required mailbox append fails,
the whole mutation rolls back. A stable membership-derived event ID makes
mailbox replay idempotent.

Pre-activation members do not yet own the ingress crypto root required to
encrypt a mailbox payload. Their join transaction first creates an ineligible
membership, attempts the confirmation, and records a confirmation-eligibility
timestamp only when missing crypto roots are the sole reason to defer. The
central activation transaction materializes only eligible member joins after
provisioning all domain roots. It consumes the eligibility timestamp after an
append, a deduplicated append, or a terminal skip such as a missing private
route, join code, or canonical origin. An append exception rolls back the
consumption with the enclosing transaction. Historical memberships and owner
rows remain ineligible, and mailbox deduplication keeps replay exactly-once.

After commit, each join adapter sends a best-effort mailbox pointer to the
member runtime. The pointer is a latency hint; the encrypted mailbox item is
the durable source of truth. A signal failure does not turn a successful join
into an error.

When activation materializes a deferred confirmation, Family acceptance uses
the already-appended `member.activated` mailbox item as the single post-commit
runtime signal. Runtime mailbox reconciliation imports the preceding group
confirmation from the same lane; no second scheduler or confirmation-specific
signal is required.

## Deployment concerns

Apply the additive `hosted_member_routing` and `hosted_group_member`
migrations before deploying the web producer that writes route identity and
confirmation eligibility. The hosted runtime already supports the generic
assistant-notification mailbox contract, so Vercel and Cloudflare do not
require a tandem deployment or compatibility window.
