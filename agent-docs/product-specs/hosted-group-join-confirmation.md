# Hosted Group Join Confirmation

Last verified: 2026-07-13
Status: Implemented

## User behavior

When a member first joins a hosted Murph group, Murph follows up in that
member's private account. The message names the group, confirms the completed
join without asking for a reply, and links to the existing group join page so
the member can review or change what they share.

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
  The accepted replay does recover the existing stable activation mailbox
  pointer after validation so post-commit wake and confirmation reconciliation
  can be retried without repeating acceptance mutations. Telegram preserves an
  accepted explicit token through that same canonical replay path.
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
  paired with a later phone or email credential for this confirmation. It uses
  an existing Telegram thread when available; otherwise eligibility remains
  pending until a safe private inbound persists observed Linq authority or a
  private Telegram thread rather than writing the message into the wrong
  assistant conversation.
- This flow does not use Linq participant-target delivery and therefore cannot
  start a new outbound iMessage conversation. If no private route exists, the
  join still succeeds and the confirmation remains pending.
- Generic Family, phone-result, and activation notification routing is not
  migrated by this feature. Those existing flows retain their prior
  credential-compatible delivery behavior; a broader persisted-participant
  authority cutover requires its own migration and provider re-establishment
  contract. In particular, legacy activation rows without observed participant
  authority keep their existing Linq home chat and verified phone or email
  lookup-key fallback.
- The link is a full first-party URL built from the canonical hosted web origin
  and the group's opaque join code. If no canonical public origin is
  configured, the join still succeeds and no confirmation is created.
- The existing join page edits the requested sharing set. It is not a
  leave-group control, so the message must not claim that the link or a reply
  removes membership.
- Any reply continues as a normal private conversation. This feature does not
  request a yes/no answer, add a group-leave mutation, or infer an undo from
  reaction removal.

## Messaging contract

The server renders one short, calm, private confirmation and uses the full link
once. It sanitizes the persisted group display name by removing control and
bidirectional formatting characters, collapsing whitespace, and keeping at
most 120 Unicode code points. Legacy unnamed groups use `your Murph group`.

Web joins use the neutral form: `You are now part of [group name].` Reaction
joins use the warmer form: `Hey — you are in [group name] after reacting to
the group invitation.` Both forms then explain that the linked page shows what
the member shares and can change it. The membership stores the authoritative
join origin while delivery is pending, so every retry chooses the same form.
Unknown warm-old origins use the neutral form.

The exact server-rendered copy, including the sanitized group name, exists only
in `responsePolicy.text`. Model instructions stay generic, and exact-text
notification delivery bypasses the model. The copy avoids alert, signup, and
acquisition framing.

Delivery uses the existing `assistant.notification.requested` contract with:

- `responsePolicy: require_send_exact_text`
- `deliveryDispatchMode: queue-only`
- one membership-derived key shared by the mailbox event, delivery dedupe
  token, and delivery idempotency key

There is no group-specific mailbox kind, scheduler, retry queue, or new runtime
consumer.

## Durability and failure behavior

Every new join-code membership records its confirmation obligation in the
membership transaction, independently of the rollout flag. The same row stores
`web` or `group_chat_reaction` until the obligation is consumed. When the
producer is enabled and the required route and crypto roots already exist,
membership, grants, revokes, and the confirmation mailbox item share that
transaction. If a required mailbox append fails, the whole mutation rolls
back. A stable membership-derived event ID makes mailbox replay idempotent.

The additive migrations add nullable eligibility and origin columns. The
eligibility migration temporarily stamps new join-code member rows inserted by
a warm prior deployment. Those warm-old rows have no origin and therefore use
the neutral form. A partial `(created_at, id)` index covers only eligible member
rows so the ordered rollout drain does not scan the full membership table. The
migrations do not backfill historical memberships or owner rows. A second
temporary database bridge clears home participant
authority whenever a warm prior deployment clears the corresponding Linq home
chat, preventing a later chat from being paired with stale authority. The
post-drain contract migration removes both bridges after old production
functions can no longer write the legacy shape.

Pre-activation members do not yet own the ingress crypto root required to
encrypt a mailbox payload. Legacy Linq members may also lack the observed
participant authority required to address their existing private thread
safely. The durable obligation remains eligible while either prerequisite is
missing. After the current join, activation, or private inbound transaction
commits, one bounded post-commit sequence attempts its current runtime wake
first. A current join then retries only its targeted membership. Activation and
private inbound recovery consume up to ten of the member's eligible
memberships in stable creation order, stopping at the first deferred item and
using only the sequence's remaining time. A later trigger resumes any
remainder. This keeps historical catch-up out of the foreground transaction so
it cannot roll back a current join, activation, route update, or inbound
message.

Each foreground post-commit sequence has a five-second default total deadline
across the current wake, reconciliation transaction, and mailbox-pointer
handoff, and stops waiting when the owning request aborts. Activation uses that
default even when its caller omits an explicit timeout. Unrelated maintenance,
newsletter, and cleanup hints run only after confirmation recovery and share
the same remaining budget. Timeout or abort leaves the durable eligibility or
appended mailbox item available for a later replay.

A retry consumes eligibility and its stored join origin together after an
append, a deduplicated append, or a terminal skip such as a missing join code
or canonical public URL. An append exception rolls back only the reconciliation
transaction and retains both fields. Historical memberships and owner rows
remain ineligible, and the stable membership-derived mailbox key keeps replay
exactly-once without inferring authority from later credentials. There is no
confirmation scheduler or retry queue.

After commit, each join adapter sends a best-effort mailbox pointer to the
member runtime. The pointer is a latency hint; the encrypted mailbox item is
the durable source of truth. A signal failure does not turn a successful join
into an error.

When a post-commit retry materializes a deferred confirmation, it sends a
best-effort mailbox pointer for that appended item. Current activation and
inbound wake handoffs remain first. Reconciliation still runs after a rejected
current Linq wake, and duplicate provider-event replay carries the same member
reconciliation key, so a droppable wake or process exit does not suppress the
committed obligation. A signal failure never reverses committed work.

## Deployment concerns

Apply the additive `hosted_member_routing` and `hosted_group_member`
migrations first. Their temporary warm-old database bridges protect new legacy
writes without backfilling history. Then use a two-stage web rollout so an
older warm activation function cannot provision roots after a newer join has
recorded eligibility without also running the materializer:

1. Deploy the consumer and materializer code with
   `HOSTED_GROUP_JOIN_CONFIRMATION_PRODUCER_ENABLED` absent or set to `0`.
2. Wait at least the repository's bounded prior-function drain interval
   (`HOSTED_WEB_CONTRACT_MIGRATION_DRAIN_SECONDS`, default 300 seconds and
   currently capped at 600 seconds), then verify the production alias still
   targets that consumer-capable commit. Let the guarded Hosted Web Contract
   Migrations lane remove both compatibility bridges only after that same
   alias proof and drain.
3. After contract migration succeeds, the same repository workflow derives a
   rollout credential in memory from its existing Vercel credential, upserts
   the producer flag plus the sensitive credential in Vercel production, and
   re-proves the production alias before building that exact commit as a staged
   production deployment with automatic domain assignment disabled.
4. While the staged build runs and immediately before promotion, the workflow
   requires production to remain on the original proven deployment. If a newer
   deployment becomes current, the old workflow leaves the staged build
   unpromoted and performs no rollout drain. Otherwise it requests one staged
   promotion, waits for that exact commit to become current, verifies both
   enablement and credential authority, then calls the private internal drain
   in bounded pages until `nextCursor` is `null`. Rows that still lack crypto
   roots or a safe private route remain eligible for a later activation,
   private inbound, or join retry.

Environment update, alias drift, staged build, promotion, authority,
response-validation, and incomplete-pagination failures all stop the workflow.
Secret values are never downloaded or printed, and group content never crosses
this control path.

This is a one-time compatibility transition, not a permanent deployment owner.
Hosted-web release ownership must delete the feature-specific workflow step,
provider orchestration script, internal route, rollout bearer configuration,
and rollout-only tests and documentation in the first post-transition change
after all of these facts are proven together: the producer-enabled consumer is
current, `20260711230000_drop_group_join_compatibility_bridges` has applied,
prior production functions have drained, and one complete eligibility scan has
reached `nextCursor: null`. The ordinary producer flag remains enabled; current
joins and deferred recovery continue through the membership-owned materializer
and the existing authenticated ops drain remains available for deliberate
maintenance.

The first consumer-capable commit is the rollback floor while the producer is
enabled. To roll back below it, disable the producer and redeploy, wait the
same prior-function drain interval, and only then deploy the older build. The
hosted runtime already supports the generic assistant-notification mailbox
contract, so Cloudflare does not require a tandem deployment.
