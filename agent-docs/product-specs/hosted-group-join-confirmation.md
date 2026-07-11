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
- This flow does not use Linq participant-target delivery and therefore cannot
  start a new outbound iMessage conversation. If no private route exists, the
  join still succeeds and no confirmation is created.
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
encrypt a mailbox payload. Their join transaction commits the durable
membership without attempting the append. The central activation transaction
materializes any missing membership-derived confirmations after provisioning
all domain roots; mailbox deduplication keeps that replay exactly-once.

After commit, each join adapter sends a best-effort mailbox pointer to the
member runtime. The pointer is a latency hint; the encrypted mailbox item is
the durable source of truth. A signal failure does not turn a successful join
into an error.

## Deployment concerns

Apply the additive `hosted_member_routing` migration before deploying the web
producer that writes the home participant identity. The hosted runtime already
supports the generic assistant-notification mailbox contract, so Vercel and
Cloudflare do not require a tandem deployment or compatibility window.
