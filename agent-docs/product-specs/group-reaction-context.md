# Deferred Group Reaction Context

Last verified: 2026-07-10
Status: Implemented

## Product Goal

Murph should notice when people add or remove reactions in an established group
chat so the next real group exchange can reflect what landed, what did not, and
the room's developing taste. A reaction is background context, not a new turn:
it must never wake Murph or produce a standalone reply.

## Product Contract

- Accept verified Linq `reaction.added` and `reaction.removed` events only for
  an existing, supported, active group route. Direct chats, unknown groups,
  inactive routes, and Murph's own reactions do not enter this flow.
- Resolve the reactor, reaction type or custom emoji, group, and exact referenced
  message. When the provider supplies a part index, bind the reaction to that
  exact part; otherwise bind it to the referenced message. The reactor must be
  a canonical non-self participant of that group.
- Preserve a bounded representation of the referenced content rather than
  guessing from webhook metadata. Truncation must be explicit, and media must
  use safe descriptors rather than provider URLs or attachment identifiers.
- Append the observation as encrypted conversation context in the existing
  hosted mailbox. It is deduplicated by provider event id and does not create a
  reaction store, queue, scheduler, or second memory system.
- A reaction-context row is non-wakeable. It emits no Temporal signal or direct
  ensure request, does not count as runnable mailbox lag, and cannot start,
  restart, or keep a hosted runtime alive.
- Hold the observation until the next natural message in the same group. That
  message remains the actionable reply anchor; reaction context alone is never
  eligible for a response. Pair by provider occurrence time, using mailbox
  order only as a deterministic tie-break; delivery skew must not attach a
  later reaction to an earlier message.
- Bound deferred context to the newest 32 observations per group and 256 across
  the hosted pending set. Older overflow is terminally suppressed so reaction
  floods cannot create unbounded foreground reads or prompts.
- A removal retracts the corresponding positive or negative signal. If an add
  and removal are both pending, Murph must understand the ordered result rather
  than treating the original reaction as durable evidence. The encrypted wake
  and imported source metadata retain one opaque target key derived from the
  canonical message id plus optional part index so identical rendered text
  cannot merge distinct targets.
- Keep the existing disclosed react-to-join flow intact. Observational reaction
  ingestion must not weaken group admission, sharing consent, ordinary message
  replies, or any other product-critical flow.

## Interpretation And Memory

Reactions are weak, contextual evidence. A single like, laugh, dislike, or
custom emoji is not a durable personality claim and must not outweigh explicit
messages. Ambiguous reactions should remain ambiguous.

Repeated patterns across separate occasions may cautiously refine the existing
group-scoped Knowledge Wiki with facts such as recurring shared humor, content
preferences, or a participant's apparent tastes. Any such synthesis must:

- stay inside that group's vault and never leak into a private, global, or
  different-group profile;
- distinguish an observed pattern from a stated preference;
- account for removals and later contradictory evidence; and
- reuse the existing Knowledge Wiki write and review rules rather than creating
  reaction-specific durable state.

## Ownership And Data Flow

1. `apps/web` verifies and parses the Linq webhook, preserves any existing
   join-offer reaction behavior, and resolves the active group route.
2. Web fetches the canonical target message from Linq because the reaction
   webhook does not carry the reacted-to content. Identity, group, target, and
   optional part-index agreement are checked before persistence.
3. Web writes one encrypted, mailbox-only context item through the existing
   conversation lane without signaling orchestration.
4. The hosted runtime may import that item only through normal mailbox
   processing. The mailbox projection exposes the earliest wakeable message
   with only the bounded newest reaction suffix before it and advances existing
   durable progress over the omitted non-wakeable prefix. Assistant automation
   keeps context-only input deferred until a causally subsequent actionable
   message from the same group arrives.
5. The ordinary group turn sees the pending reaction observations alongside the
   new message and applies the group-chat behavior rules.

The encrypted mailbox is transient ingress evidence, not canonical product
truth. If repeated observations merit durable synthesis, the existing
group-scoped Knowledge Wiki is the sole owner.

## Privacy, Failure, And Retry Rules

- Logs and telemetry may contain bounded event classifications and opaque ids,
  but never raw reacted-to text, participant handles, contact values, provider
  URLs, or attachment URLs.
- Missing or contradictory group identity, actor identity, target identity,
  target chat, or part index fails closed and appends no context.
- Permanent unsupported or missing targets are ignored safely. Transient Linq
  read failures remain retryable so provider retry can complete enrichment.
- Duplicate delivery may repeat validation and target lookup, but mailbox
  event-id dedupe prevents duplicate context.
- Overflow suppression records opaque input evidence only; it must not copy raw
  reacted-to content into logs or control-plane state.
- Provider payloads and target content must not enter Temporal workflow state,
  orchestration signals, or unencrypted control-plane state.

## Acceptance Criteria

- Adding a supported reaction in an active Linq group persists one encrypted
  context item containing the reactor, reaction, and correct target content.
- Removing it persists a retraction that cancels the earlier weak signal.
- Neither event starts runtime work, changes wakeable mailbox high-water, or
  causes Murph to reply.
- The next natural message in that group exposes pending reaction context and
  remains the response target.
- Invalid targets fail closed, transient provider reads retry, duplicates are
  idempotent, and no sensitive reaction content appears in logs.
- Existing group join-offer reactions and ordinary conversation ingress retain
  their prior behavior.

## Deployment Concerns

The runner must understand and safely defer the new mailbox context before web
begins producing it. Deploy the Cloudflare/runner bundle first with immediate
container rollout, then deploy Vercel/web. The web producer is default-off and
must remain disabled until the managed runner fleet reports the compatible
bundle fingerprint; enable it only by setting
`HOSTED_LINQ_GROUP_REACTION_CONTEXT_ENABLED=1` after that proof. This gate is
required because `reaction.added` may already be subscribed for the existing
join-offer flow. While the gate is disabled, unmatched observational reactions
receive a retryable 503 instead of a successful acknowledgement, while accepted
join-offer reactions retain their existing success path. Enable the producer
immediately after the compatible managed-runner fingerprint is proven so
provider retries can stage the deferred context. New-runner/old-web is
compatible; new-web/old-runner is not a supported window because an old runner
may reject or mis-handle the context row. Keep the new runner as the rollback
floor until the web producer is disabled or reverted.

Mailbox projection anchors on the earliest wakeable message, preserves the
caller's bounded ordinary-message page, and exposes only a bounded reaction
window around it. When an older leading prefix is
omitted, the response carries a typed reaction-only boundary; runtime state
records suppression before advancing the existing watermark. The runtime
pending-input index remains the semantic retention owner and enforces the
newest 32 items per group and 256 total items after decryption. Projection only
caps foreground transport work and cannot classify decrypted group ownership.

Before enabling production ingestion, verify the Linq webhook subscription
includes both `reaction.added` and `reaction.removed`; source configuration or a
local tunnel is not proof of the production dashboard state. Post-deploy, prove
that an add and removal produce no invocation, then send one natural group
message and confirm both the deferred context and existing join-offer behavior.
