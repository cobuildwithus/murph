# Group Reaction Context And Affirmative Replies

Last verified: 2026-07-12
Status: Implemented

## Product Goal

Murph should notice when people add or remove reactions in an established group
chat so the conversation can reflect what landed, what did not, and the room's
developing taste. Most reactions are background context, not a new turn. An
affirmative reaction to Murph's own exact message is the narrow exception: it
can answer the question or accept the action Murph just offered without forcing
the member to send a second text.

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
- Append the observation in the existing encrypted conversation mailbox. It is
  deduplicated by provider event id and does not create a reaction store, queue,
  scheduler, classifier, or second memory system.
- A reaction-context row is non-wakeable. It emits no Temporal signal or direct
  ensure request, does not count as runnable mailbox lag, and cannot start,
  restart, or keep a hosted runtime alive.
- When the canonical target is Murph-authored and the reaction is like, love,
  heart, thumbs-up, or its supported emoji equivalent, represent the add as an
  ordinary wakeable group reply anchored to that exact target message and part.
  The assistant interprets the reacted-to content: when the reaction clearly
  confirms the exact question or offered action, it follows through without
  asking the same confirmation again. Separate authorization, payment, and
  irreversible-effect safeguards not covered by that exact question remain.
- Represent removal of that same affirmative reply as a wakeable withdrawal so
  pending follow-through can stop before an irreversible effect. Do not infer
  any unrelated request from either the add or removal.
- Hold context-only observations until the next natural message in the same
  group. That message remains their actionable reply anchor; deferred reaction
  context alone is never eligible for a response. Pair by provider occurrence
  time, using mailbox order only as a deterministic tie-break; delivery skew
  must not attach a later reaction to an earlier message.
- Bound deferred context to the newest 32 observations per group and 256 across
  the hosted pending set. Older overflow is terminally suppressed so reaction
  floods cannot create unbounded foreground reads or prompts.
- A removal retracts the corresponding positive or negative signal. If an add
  and removal are both pending, Murph must understand the ordered result rather
  than treating the original reaction as durable evidence. The encrypted wake
  and imported source metadata retain one opaque target key derived from the
  canonical message id plus optional part index so identical rendered text
  cannot merge distinct targets.
- Keep the existing disclosed react-to-join flow intact and give it priority:
  its accepted reaction remains context-only for assistant automation so one
  tap does not both accept membership and create a second assistant turn.
  Reaction ingestion must not weaken group admission, sharing consent, ordinary
  message replies, or any other product-critical flow.

## Interpretation And Memory

Reactions are weak, contextual evidence. The affirmative-reply exception is
only turn intent for Murph's exact reacted-to message; it is not a durable
personality claim and must not outweigh explicit messages. Ambiguous reactions
should remain ambiguous.

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
3. Web writes either a non-wakeable `conversation.reaction` context item or,
   for an affirmative reaction to Murph's own target, an ordinary
   `conversation.message` reply with the exact native reply anchor.
4. Web signals the existing Temporal/direct-ensure handoff only for the
   wakeable reply. Duplicate provider delivery re-hands off the existing
   actionable row without treating stale lane facts as fresh authority.
5. The hosted runtime imports both shapes through normal mailbox processing.
   The mailbox projection exposes the earliest wakeable message with only the
   bounded newest reaction suffix before it and advances existing durable
   progress over the omitted non-wakeable prefix. Assistant automation keeps
   context-only input deferred until a causally subsequent actionable message
   from the same group arrives.
6. The group turn interprets the exact target and reaction through the group-chat
   behavior rules; the reaction itself never bypasses effect authority.

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
  event-id dedupe prevents duplicate input; duplicate actionable rows repeat
  only the idempotent runtime handoff.
- Overflow suppression records opaque input evidence only; it must not copy raw
  reacted-to content into logs or control-plane state.
- Provider payloads and target content must not enter Temporal workflow state,
  orchestration signals, or unencrypted control-plane state.

## Acceptance Criteria

- Adding a supported reaction in an active Linq group persists one encrypted
  item containing the reactor, reaction, and correct target content.
- Ordinary reactions remain non-wakeable deferred context, and removal retracts
  the earlier weak signal.
- An affirmative add to Murph's own target becomes one wakeable exact reply; its
  removal becomes one wakeable withdrawal. Both retain the target message/part
  anchor and the normal effect safeguards.
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

Mailbox projection preserves strict lane progress and never advances over
unimported reaction rows. The runtime pending-input index is the sole retention
owner: it records typed suppression evidence before enforcing the newest 32
items per group and 256 total items. Active-turn conversation fetches reserve
that 256-item context allowance so the next natural message can be imported in
the same bounded pass without moving retention policy into SQL.

Before enabling production ingestion, verify the Linq webhook subscription
includes both `reaction.added` and `reaction.removed`; source configuration or a
local tunnel is not proof of the production dashboard state. Post-deploy, prove
that ordinary add/removal events produce no invocation, an affirmative reaction
to Murph's own question invokes one exact anchored turn, removal can withdraw
pending follow-through, and existing join-offer behavior does not create a
second assistant turn.
