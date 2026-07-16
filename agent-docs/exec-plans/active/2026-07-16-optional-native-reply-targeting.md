# Shared accepted-message targeting for replies and reactions

Status: active
Created: 2026-07-16
Updated: 2026-07-16

## Goal

- Let Murph optionally attach a normal response to one specific accepted
  inbound message when the channel supports provider-native replies.
- Let Murph react to one specific accepted inbound message instead of
  implicitly reacting to the latest message in a delivery context.
- Make both actions use the same opaque message reference, accepted-context
  membership check, stored input event, provider-private target, and delivery
  override.
- Keep ordinary responses flat by default in direct and group conversations.
- Preserve the current input journal, steering, delivery, outbox, provider,
  and hosted authority owners. Add no database, sidecar, queue, service,
  scheduler, or second send path.

## Final architecture decision

Keep two tools because they perform different effects, but give them one
targeting primitive:

```json
{
  "tool": "murph.select_reply_target",
  "arguments": {
    "message_ref": "ain_<opaque-input-id>"
  }
}
```

```json
{
  "tool": "murph.react_to_message",
  "arguments": {
    "message_ref": "ain_<opaque-input-id>",
    "reaction": "thumbs_up"
  }
}
```

`message_ref` is the existing `AssistantInputEvent.inputId`. It is not a
provider message id and does not require a new reference map.

Both calls use one shared resolver. The resolver proves that the reference is
part of the exact accepted-input context, loads that stored event, validates
the current route and thread, and privately reads its existing
`replyTarget.messageId`. A small action policy then checks native-reply or
reaction capability. Provider ids never enter the prompt, tool arguments,
tool results, provider transcript, or response metadata.

The tools diverge only after targeting:

- `select_reply_target` records response metadata. The normal reply path sends
  the response later.
- `react_to_message` records a reaction action. The existing reaction delivery
  and reaction outbox operation send it later.

The complete data flow is:

```text
accepted AssistantInputEvent(inputId, replyTarget)
  -> prompt renders one opaque Message ref
  -> either tool submits the same message_ref
  -> shared resolver validates exact context + event + route + thread
  -> action policy validates native-reply or reaction capability
  -> provider result stores {deliveryContextOrdinal, targetInputId}
  -> local service re-resolves the same event before delivery
  -> existing reply-context override sets deliveryReplyToMessageId on a local clone
  -> existing reply or reaction delivery path creates the outbox intent
  -> existing Telegram or Linq adapter performs the effect
```

No tool call means no native reply. The same contract applies to direct and
group routes that are already authorized. It does not enable a new group
ingress path.

## Why this is the smallest durable design

- One existing opaque id identifies a model-visible message. There is no
  provider-id map or second identity system.
- One base resolver owns membership, identity, route, thread, and privacy
  checks. Two narrow policies own the genuinely different provider
  capabilities.
- One existing `deliveryReplyToMessageId` field carries the provider target
  for both effects after resolution.
- One existing reply-context override clones the input for the selected
  effect. Shared turn input is never mutated.
- One existing outbox owns persistence and retries. Reactions keep their
  existing reaction operation; native replies add only the minimum durable
  discriminator needed to distinguish explicit intent from legacy Linq state.
- Dash-delimited bubbles need no coordinator or first-bubble branch. Each
  intentional bubble receives the same selected reply context.

Do not introduce a generic “message action” tool. Reply selection is response
metadata, while a reaction is a provider effect. Combining them would add an
action union without removing a runtime owner.

## User-visible contract

- Murph usually posts a normal flat response.
- Murph may select a native reply when a specific current message materially
  improves clarity.
- Murph may react to a specific current message, including a message that is
  not the latest one in a grouped turn.
- Reply and reaction tools may target different accepted messages in the same
  response context.
- If Murph splits one response with the `---` delimiter, every intentional
  bubble replies to the same selected inbound message.
- Separate completed responses created by live steering may select separate
  targets.
- A selected target that becomes invalid causes an explicit delivery failure.
  Murph never silently sends the effect flat, against the latest message, or
  into a newly created chat.
- Typing indicators, progress updates, read receipts, route selection, and
  answered-mailbox ownership remain unchanged.

## Current architecture proof

The implementation must preserve these existing facts:

1. `AssistantInputEvent` already owns durable current-message identity in
   `replyTarget.{channel,messageId,threadId}`. Its opaque `inputId` is already
   the accepted-input journal reference. Another lookup table would duplicate
   that owner.
2. Linq `sourceMetadata.replyToMessageId` means the older Murph message to
   which the user replied. It is semantic input context, not the outgoing
   target, and must not be reused.
3. `responseDeliveryContextOrdinal` identifies an accepted-input or steering
   boundary. One boundary can contain several input ids, so the ordinal alone
   cannot identify one sender's message instead of another's.
4. The current `react_to_message` tool accepts only `reaction`. Its result is
   keyed by the context ordinal, and delivery resolves that context's current
   `deliveryReplyToMessageId`. It therefore cannot select among several
   accepted messages in one context.
5. Reactions already reach the same provider-id seam needed by replies:
   `AssistantInputEvent.replyTarget.messageId` becomes
   `AssistantMessageInput.deliveryReplyToMessageId`, then outbox
   `replyToMessageId`.
6. Codex already carries context-scoped response metadata for media,
   reactions, no-reply actions, final responses, and preceding steered
   response segments. Target input ids belong beside those fields.
7. `AssistantMessageInput.deliveryReplyToMessageId` is also read by progress,
   typing, routing, and engagement checks. Mutating the shared input would
   retarget unrelated effects.
8. `AssistantReplyDeliveryContextOverrides` and
   `applyAssistantReplyDeliveryContextOverrides` already provide the correct
   effect-local clone seam.
9. `deliverAssistantReply` already passes one input to every intentional
   `---` bubble. Passing the selected clone and marker to that existing loop
   naturally targets every bubble.
10. The outbox already owns atomic persistence, target identity, idempotency,
    retry, ambiguous-send handling, and hosted replay. A new operation owner is
    unnecessary.
11. `AssistantOutboxOperation` currently identifies reaction payloads. Its
    parsing and dispatch paths assume `message-reaction`; using it to describe
    native-reply presentation would conflate two different concerns and force
    a wider refactor.
12. Telegram already serializes `reply_to_message_id`. Its adapter owns
    internal text chunking and media fan-out.
13. Commit `915baf98a7` removed Linq `reply_to` serialization while leaving
    `replyToMessageId` populated and persisted. A legacy Linq intent can
    therefore have a non-null id while still meaning “send flat.”
14. Linq exposes `reply_to.message_id` for iMessage. Actual inbound `service`,
    not `preferred_service`, is authoritative because protocol selection can
    fall back.
15. Linq's dedicated voice-memo endpoint has no reply field. Standard
    text/media delivery can carry a native reply; a voice-only selected
    response cannot.
16. Linq missing-chat recovery can create a participant chat. That is valid
    for flat delivery but would drop an explicit reply target.

## Invariants

1. **Flat is the default.** Missing reply selection means no automatic native
   anchor. Missing reaction selection means no reaction.
2. **The model requests; runtime authorizes.** Only runtime code may resolve an
   opaque reference to a provider id. Provider-entry authority checks remain
   final.
3. **Only exact current accepted input is targetable.** The reference must
   belong to the accepted-input prefix for that delivery-context ordinal. No
   fallback may substitute a wider provider request or session list.
4. **Provider ids stay private.** Raw provider message and thread ids never
   enter model-visible or diagnostic surfaces.
5. **Both actions use the same target identity.** Their durable provider target
   comes from the same stored event and the same local
   `deliveryReplyToMessageId` override. There is no reply-only id map or
   reaction-only lookup.
6. **Effects stay isolated.** Reply selection affects only normal final reply
   delivery. A targeted reaction affects only that reaction. Neither changes
   progress, typing, routing, read receipts, or the other action.
7. **Every intentional bubble inherits the reply target.** All messages
   produced by the explicit `---` bubble split persist the same selected target
   and marker. Channel adapters continue to own their internal chunk and media
   behavior.
8. **Frozen prepared effects.** Normal message retries always keep the same
   target and marker. Each prepared reaction attempt is also immutable, as is
   any sent, delivered, or ambiguously confirmed reaction. Preserve the
   existing reaction-only settlement window between known failed attempts.
9. **No target-dropping recovery.** A missing chat/message or unsupported
   payload fails before replacement-chat or unthreaded delivery is attempted.
10. **Legacy Linq safety.** An unmarked Linq message intent remains flat even
    when its existing contextual `replyToMessageId` is non-null.
11. **Current-conversation priority and steering stay intact.** Each steer gets
    an independent action scope. No selection leaks across contexts.
12. **One writer per effect.** Final reply delivery and reaction delivery keep
    using the existing outbox. Neither model tool sends directly.

## Shared target primitive

### Model reference

- Render `Message ref: ain_...` beside each accepted Telegram or Linq prompt
  input that is eligible for at least one registered target action.
- Render the same reference once. Do not add separate reply and reaction refs.
- Keep `Input N` only as a readability label. It is batch-local, absent for one
  input, and can restart when projected and captureless prompts are combined.
- Update failed-prompt extraction so the synthetic reference cannot be
  persisted as user text.
- Do not render refs for context-only replay, email, proactive work, or inputs
  with no action-eligible provider target.

### Shared selection shape

Use the same inline pair wherever provider results identify a target:
`{deliveryContextOrdinal, targetInputId}`. Do not add an exported wrapper type
only to hold those two fields, and do not add provider ids to the pair.

### Shared resolver

Add one small async resolver, preferably in
`assistant/message-target-selection.ts` only if no existing module is a
cleaner home. It uses the existing input-event reader and delegates membership
and capability validation to pure functions. Given a delivery-context ordinal,
`message_ref`, current route context, and requested capability, it must:

1. Require the exact delivery-context entry. Never fall back to a wider
   accepted-input list.
2. Require `message_ref` to be one of that context's accepted input ids.
3. Read the matching stored `AssistantInputEvent` and verify id/content
   binding.
4. Require the event conversation to match the accepted context's `source`,
   `accountId`, `threadId`, and `threadIsDirect`. Do not require `actorId`
   equality in a group.
5. Require a non-null `replyTarget` whose channel and thread independently
   match the current delivery route.
6. For a Linq group, require existing external thread-route authority before
   either action policy runs.
7. Require a real provider message scalar. Reject empty, internal, and
   privacy-blinded values such as `ain_`, `hid_`, `hbid:`, and `hbidx:`.
8. Apply the requested action policy described below.
9. Return the accepted input id to provider-result state. After the same
   resolution runs again immediately before intent creation, expose only the
   effect-local delivery overrides: the provider message id for either action,
   plus the selected event's reaction-eligibility proof for a reaction.

Split the implementation into one base validation function and two small
capability predicates. Do not build separate end-to-end resolvers whose
membership and privacy rules can drift.

Local service already owns the exact ordinal-indexed accepted-input ids. Expose
one narrow callback to provider-tool execution:

```ts
authorizeAcceptedMessageTarget({
  action,
  deliveryContextOrdinal,
  messageRef,
})
```

Capture the ordinal before tool execution, as the current reaction path does.
The callback must consult the exact `acceptedInputIdsByDeliveryContextOrdinal`
entry and the existing input reader. It must not resolve from mutable
`currentUserActionScope`, a cumulative accepted-input list, hosted tool scope,
or session history. Return only action success and `targetInputId` across the
provider boundary.

### Action policies

Native reply policy:

- Telegram requires an admitted Telegram conversation route and a valid
  current provider message id.
- Linq requires case-insensitive actual
  `sourceMetadata.service === "imessage"`.
- Linq group delivery also passes the shared external thread-route authority
  prerequisite above.
- SMS, RCS, missing/unknown service, email, and non-conversational turns fail.

Reaction policy:

- Require a channel adapter with `setMessageReaction`.
- Linq requires the target event's existing
  `sourceMetadata.reactionEligible === true` proof.
- Linq group reactions pass the same shared external thread-route authority
  prerequisite as native replies.
- Telegram preserves the existing business-connection exclusion and current
  reaction capability checks.
- Re-evaluate the policy on the selected event, not only on whichever event
  happened to be latest in the grouped context.

The base resolver and action policies run at tool acceptance and again before
intent creation. A second-pass failure returns a typed, secret-safe delivery
error. It does not clear the target or change the effect.

## Tool contracts and call semantics

### Static registration

- Add `murph.select_reply_target` to the centralized dynamic-tool catalog.
- Change `murph.react_to_message` so `message_ref` is required beside
  `reaction`.
- Validate the reference as `ain_` plus 32 lowercase hexadecimal characters.
- Keep both schemas strict and static. Candidate-specific enums or refs must
  not enter tool definitions because the definitions are part of the Codex
  thread compatibility fingerprint.
- Register the tools through one default-off conversational route capability
  for Telegram and Linq. Candidate resolution remains authoritative, so a
  static tool may be inert until a later eligible steer.
- Maintenance and output-only turns expose neither tool.
- The reaction schema fingerprint change must rotate incompatible stored Codex
  threads through the existing contract-mismatch path. Do not retain an
  optional implicit-current fallback or compatibility shim.

### Semantics

- `select_reply_target` is side-effect free. It annotates only the eventual
  response in the same context.
- `react_to_message` queues one existing reaction effect. It does not send
  text and does not finish the turn.
- Key both action patches by `deliveryContextOrdinal`.
- Store `targetInputId` on both patches. Store `reaction` only on the reaction
  patch.
- The last successful call for an action in one context wins. Repeating an
  identical call is idempotent.
- A malformed, forged, stale, wrong-context, wrong-thread, or ineligible call
  returns `success: false` and preserves any earlier valid patch.
- Reply and reaction patches are independent and may target different input
  ids.
- A later steer starts a new context for both actions.
- `finish_without_reply` discards that context's reply selection but retains a
  valid reaction, matching the existing reaction-only completion contract.
- Provider failure recovery carries no reply selection because it carries no
  final response. Preserve an already-recorded reaction only where the current
  recovery contract already does so.
- Add no clear/null action. Omission means no effect, and another valid call
  can replace an earlier target.
- Tool results and validation digests remain value-free. They may say
  “selection recorded” or “reaction queued,” never echo the reference or
  provider id.

## Provider result, steering, and local resolution

- Add nullable reply target input metadata to the final Codex result and each
  preceding response segment.
- Extend the existing reaction action from
  `{deliveryContextOrdinal, reaction}` to
  `{deliveryContextOrdinal, targetInputId, reaction}`. Rename
  `AssistantCurrentMessageReactionAction` if needed because “current message”
  is no longer its contract.
- Mirror these fields through `AssistantProviderTurnExecutionResult`, Codex
  provider plumbing, the turn runner, and `AssistantPrecedingReplySegment`.
- Keep `responseDeliveryContextOrdinal` unchanged. It identifies the context;
  `targetInputId` identifies the message inside it.
- Serialize stateful tool patch application so concurrent calls cannot race.
- Snapshot each completed response's reply target when it becomes a preceding
  steered segment. Then clear reply and reaction patch state for the next
  context according to current segment ownership.
- Keep target metadata out of model transcript responses, session bindings,
  canonical product state, diagnostics, and provider-failure text.

Immediately before each effect:

1. Resolve the segment or reaction delivery context by ordinal.
2. Re-run shared target resolution for `targetInputId` and the action.
3. Use `applyAssistantReplyDeliveryContextOverrides` to create a local
   `AssistantMessageInput` clone whose existing `deliveryReplyToMessageId` is
   the selected event's provider message id. For a Linq reaction, also derive
   `deliveryMessageReactionsAvailable` from that selected event instead of the
   latest event in the grouped context.
4. Pass that clone only to the selected reply or reaction delivery call.

Do not add `nativeReplyToMessageId`, mutate the shared input, or put provider
ids in provider-result state.

## Reply delivery and dash bubbles

Pass one response-only authorization flag through normal reply delivery:

```ts
nativeReplyRequested?: true
```

- A validated reply selection supplies the targeted local input clone and
  `nativeReplyRequested: true`.
- No selection uses the ordinary input and omits the flag.
- `deliverAssistantReply` passes the same targeted clone and flag to every
  message created by `splitAssistantReplyBubbles`.
- Each bubble keeps its existing ordering, media assignment, answered-mailbox
  assignment, and idempotency key. Each resulting message intent persists the
  same selected `replyToMessageId` and marker.
- Do not add “first bubble only,” bubble-index conditionals, or a logical-effect
  coordinator.
- Provider-internal chunks and media are not dash bubbles. The channel adapter
  keeps ownership of that fan-out and its partial-delivery behavior.

This answers the delimiter case directly: if one response is split into three
intentional bubbles, all three are native replies to the selected inbound
message.

## Reaction delivery

- Resolve the reaction's `targetInputId` with the shared primitive.
- Apply the selected provider id through the same local
  `deliveryReplyToMessageId` override used for reply delivery. Apply the
  selected event's reaction-eligibility proof through the existing
  `deliveryMessageReactionsAvailable` override.
- Call existing `deliverAssistantReaction` with that clone.
- Keep the existing `message-reaction` outbox operation and
  `targetMessageId/replyToMessageId` persistence.
- Do not add `nativeReplyRequested` to reaction intents. The reaction operation
  already proves the effect kind and does not share Linq's flat-message
  ambiguity.
- Preserve the exact existing reaction-only atomic upgrade window: status is
  `pending` or `retryable`, `sentAt` and `delivery` are null,
  `deliveryConfirmationPending` is false, and `preparedDispatchToken` is null.
  That includes settlement after a known non-ambiguous failed attempt. While a
  dispatch is prepared, or after send/delivery/ambiguous evidence exists, any
  mismatch fails closed.
- Keep one reaction per delivery context in v1, matching current last-wins
  behavior. Supporting several reactions in one context is a separate product
  requirement, not necessary for exact targeting.

## Crash-safe message outbox contract

`replyToMessageId` alone cannot prove explicit native-reply intent because
pre-feature Linq auto-reply intents can contain that value while the serializer
deliberately ignores it.

Add one optional true-only field to the existing message intent:

```ts
nativeReplyRequested?: true
```

Rules:

- Every bubble from a validated selection persists the chosen
  `replyToMessageId` and `nativeReplyRequested: true` atomically.
- Unselected automatic delivery preserves contextual target fields that
  existing authority checks need and omits the marker.
- Missing marker means flat automatic message serialization. Never persist
  `false`.
- Marked state is valid only for a normal message intent with a non-null,
  provider-valid reply id. Validate Telegram's numeric message-id shape before
  persistence. Malformed marked state is terminal; it never normalizes to
  flat.
- Include the marker in target fingerprinting, equality, and non-token dedupe
  identity because it changes the provider effect.
- Preserve the existing dedupe-token fast path. For normal message intents, a
  token hit with a different target or marker fails closed instead of
  promoting flat to marked or marked to flat. The reaction-only pre-dispatch
  or between-attempt settlement rule above remains separate.
- Whenever a request has a dedupe token and the store returns an existing
  normal message intent, compare its normalized `replyToMessageId` and marker
  with the requested effect in `outbox.ts` before any return or upgrade. Run
  this check regardless of whether lookup matched the ordinary exact token
  hash or a delivery-idempotency fallback. Hash participation alone is
  insufficient because token identity intentionally omits other target fields.
- Keep the marker immutable through creation, reload, prepared dispatch,
  retry, mirror reconciliation, hosted payload parsing, and replay.
- Preserve the raw contextual reply id through hosted authority checks. Carry
  the marker beside it; do not project the id to null.
- Do not add a new `AssistantOutboxOperation` variant. Reactions keep their
  existing operation, while the marker qualifies only normal message
  presentation.

## Provider behavior

### Telegram

- Keep the existing `reply_to_message_id` transport primitive.
- Marked automatic message intents may pass the selected id through the
  existing adapter. Unmarked automatic messages remain flat. Preserve current
  manual and low-level targeting behavior.
- Make `resolveAssistantCurrentAudienceTextDeliveryFields` and
  `shouldSuppressAssistantNativeTextReplyToMessageId` marker-aware. They must
  continue clearing unmarked Telegram auto-reply ids and preserve only a
  validated marked selection before outbox creation.
- Every intentional dash bubble enters the adapter with the same id.
- Keep internal adapter behavior local: oversized text anchors its first
  provider chunk; image delivery anchors its first eligible provider effect;
  current text-plus-voice orchestration may pass the id to both text and voice.
  Do not add cross-effect state solely to make these internal variants look
  identical.
- Preserve non-idempotent ambiguous-send and rollback behavior.

### Linq/iMessage

- Restore `message.reply_to = {message_id}` only in the final assistant Linq
  message-body builder when `nativeReplyRequested === true`.
- Omit `part_index`; Murph owns message-level authority only.
- Apply the guarded serializer independently to every marked dash-bubble
  intent.
- Keep the web Linq client flat. Signup, onboarding, quota, invitation, join,
  and other web-owned messages are not model-selected assistant replies.
- Disable local and hosted missing-thread/new-participant recovery for a
  marked intent. A failed standard send may already have uploaded an attachment,
  but it must never create a replacement chat or send the message unthreaded.
- A standard text/media message can carry the reply anchor.
- Text plus voice anchors the standard text message; the dedicated voice memo
  remains an unthreaded continuation because its endpoint has no reply field.
- A voice-only marked response fails before the Linq message or voice-send
  endpoint. Voice preparation may already have created an unattached upload;
  do not add a separate provider capability probe solely to prevent that
  upload. Never send the response flat or claim that it was anchored.
- Invalid or deleted reply targets fail terminally. Retryable idempotent
  failures retry only the identical marked effect.

### Cloudflare and web

- Add no web product API, database state, Durable Object state, or Cloudflare
  operation.
- The existing provider-egress proxy should forward the guarded Linq body and
  Telegram request unchanged. Add a regression assertion only if existing
  coverage does not prove this. Do not add production proxy code without a
  failing test.

## Capability matrix

| Accepted input | Native reply | Reaction | Rule |
| --- | --- | --- | --- |
| Telegram direct | Yes | Yes, except existing business-connection exclusion | Existing admitted route and a real provider message id are required. |
| Telegram group | Not currently reachable | Not currently reachable | The shared primitive is directness-neutral, but this work does not enable group ingress. |
| Linq/iMessage direct | Yes | Only when target event says `reactionEligible` | Actual inbound service must be iMessage. |
| Route-authorized Linq/iMessage group | Yes | Only when target event says `reactionEligible` | Existing external thread authority is also required. |
| Linq SMS/RCS | No | No | Do not infer iMessage capability from preferences or history. |
| Linq missing/unknown service | No | No | Fail closed. |
| Email, scheduled/proactive work, notifications, maintenance, Assistant Ask, output-only turns | No | No | No eligible accepted conversational target exists. |
| Context-only replay with `replyTarget: null` | No | No | Historical context is not current effect authority. |

## Rollout sequence

Use two PRs and releases because the persisted outbox schema is strict. Phase B
starts from deployed Phase A. Do not let a Phase B writer reach a Phase A-old
reader.

### Phase A: expand readers and make message delivery backward-safe

1. Add optional `nativeReplyRequested?: true` parsing, persistence,
   fingerprinting, equality, dedupe, dispatch, hosted payload, and replay
   plumbing. Omit it when absent.
2. Make Telegram auto-reply suppression marker-aware before outbox creation,
   while preserving current flat behavior for every unmarked response.
3. Restore marker-gated assistant Linq `reply_to` serialization.
4. Harden local and hosted missing-chat recovery and enforce the Linq
   voice-only send preflight without adding a separate provider probe.
5. Add marked-intent and unmarked-legacy regressions. Do not expose the new
   selector or let normal response delivery write the marker.
6. Merge and deploy Phase A. Confirm its exact runner fingerprint across the
   fleet before Phase B can write the field.

Phase A changes no production automatic reply behavior. No producer can set
the marker, and every legacy intent remains flat. It is the rollback floor for
Phase B.

### Phase B: enable shared message targeting

1. Render shared opaque refs and update failed-prompt extraction.
2. Add the reply-selector schema and make `message_ref` required on the
   reaction schema. Let the existing contract fingerprint rotate incompatible
   Codex threads.
3. Add one shared resolver, two capability predicates, and serialized
   context-scoped reply and reaction patches.
4. Add target input metadata to final, preceding, and reaction provider
   results.
5. Re-resolve targets in local service, create effect-local input clones with
   the existing override helper, and route both actions through existing
   delivery owners.
6. Pass the reply marker to every intentional bubble. Keep reactions on their
   existing outbox operation.
7. Add direct/group, steering, no-reply, negative capability, media, outbox,
   hosted authority, and end-to-end coverage.
8. Merge and deploy only after Phase A's exact fingerprint is proven live.

Rollback from Phase B to Phase A preserves marked intent parsing and delivery.
Do not roll below Phase A while a marked intent can remain in any workspace.
No migration or cleanup job is otherwise required.

## Expected source ownership

Keep changes within current owners. Delete redundant current-message reaction
logic as the shared resolver replaces it.

- Shared refs and target policy:
  - `packages/assistant-engine/src/assistant/message-target-selection.ts`
    (new only if an existing owner is not smaller)
  - `packages/assistant-engine/src/assistant/automation/reply.ts`
  - `packages/assistant-engine/src/assistant/automation/prompt-builder.ts`
  - `packages/assistant-engine/src/assistant/prompt-attempts.ts`
- Static tools, prompt guidance, and provider-result metadata:
  - `packages/assistant-engine/src/assistant-codex/dynamic-tools.ts`
  - `packages/assistant-engine/src/assistant-codex.ts`
  - `packages/assistant-engine/src/assistant/system-prompt.ts`
  - `packages/assistant-engine/src/assistant/codex-turn/planning.ts`
  - `packages/assistant-engine/src/assistant/providers/types.ts`
  - `packages/assistant-engine/src/assistant/providers/codex-cli.ts`
  - `packages/assistant-engine/src/assistant/codex-turn-runner.ts`
- Local resolution, steering, and effect-local overrides:
  - `packages/assistant-engine/src/assistant/service-contracts.ts`
  - `packages/assistant-engine/src/assistant/local-service.ts`
  - `packages/assistant-engine/src/assistant/reply-delivery-context.ts`
  - `packages/assistant-engine/src/assistant/delivery-service.ts`
- Atomic effect and channel transport:
  - `packages/operator-config/src/assistant-cli-contracts.ts`
  - `packages/assistant-engine/src/outbound-channel.ts`
  - `packages/assistant-engine/src/assistant/outbox/intents.ts`
  - `packages/assistant-engine/src/assistant/outbox.ts`
  - `packages/assistant-engine/src/assistant/channels/types.ts`
  - `packages/assistant-engine/src/assistant/channels/helpers.ts`
  - `packages/assistant-engine/src/assistant/channels/descriptors.ts`
  - `packages/assistant-engine/src/assistant/channels/runtime.ts`
  - `packages/operator-config/src/linq-runtime.ts`
- Hosted authority and replay:
  - `packages/hosted-execution/src/side-effects.ts`
  - `packages/hosted-execution/test/side-effects.test.ts`
  - `packages/assistant-runtime/src/hosted-runtime/callbacks.ts`
  - `packages/assistant-runtime/src/hosted-provider-effects.ts`
  - `packages/assistant-runtime/src/hosted-runtime/linq-delivery-context.ts`
  - `packages/assistant-runtime/src/hosted-runtime/platform.ts`
- Hosted-local scenario proof:
  - `packages/hosted-local-harness/src/e2e.ts`
  - `apps/cloudflare/test/hosted-local-optional-native-reply-compatibility-e2e.test.ts`
  - `apps/cloudflare/test/hosted-local-message-targeting-e2e.test.ts`
  - `.github/workflows/cloudflare-hosted-e2e.yml`

Do not edit `input-store.ts` merely to add another identity. Reuse
`AssistantInputEvent.inputId` and `readAssistantInputEvent`. Do not change the
web Linq client's production serializer.

## Test plan

### References and shared resolver

- Single, grouped, projected, captureless, and late-steered eligible inputs
  render unique opaque refs once per input.
- Failed-prompt extraction excludes synthetic ref lines.
- The same ref can validly target a reply or a reaction when both policies
  allow it.
- Forged, stale, wrong-context, wrong-thread, privacy-blinded, and ineligible
  refs fail without replacing an earlier valid action patch.
- Exact-context lookup never falls back to a wider accepted-input list.
- Raw provider ids never appear in prompts, tool results, validation digests,
  traces, or failure previews.

### Tool contract and response lifecycle

- Both strict schemas are static and included in the assistant contract
  fingerprint.
- The old reaction call shape without `message_ref` is rejected; a stored
  thread with the old schema rotates through existing fingerprint handling.
- One reaction can target an older message inside a multi-message accepted
  context.
- Linq reaction eligibility follows the selected event in both directions:
  eligible older/ineligible latest succeeds, while ineligible older/eligible
  latest fails.
- Reply and reaction calls in the same context can target different messages.
- Same selection is idempotent; the last successful call for each action wins.
- Two preceding steered segments and the final segment retain independent
  targets without leakage.
- `finish_without_reply` removes only reply output/selection and still permits
  a targeted reaction-only turn.
- Provider failure recovery cannot invent or expose a target.

### Effect isolation

- Target resolution creates a local input clone and leaves the shared
  `AssistantMessageInput` unchanged.
- Reply targeting cannot retarget a reaction, progress update, typing
  indicator, route, answered-mailbox id, or transcript.
- Reaction targeting cannot retarget the final reply or other side effects.
- Both delivery paths derive the provider target from the same stored event and
  `deliveryReplyToMessageId` override.

### Reply bubbles, outbox, and replay

- Unselected Telegram and Linq automatic responses remain flat.
- A selected one-, two-, and four-bubble response writes the same target and
  marker on every bubble intent.
- Bubble ordering, media placement, answered-mailbox ownership, and existing
  per-bubble idempotency keys are unchanged.
- The selected target survives queue-only creation, snapshot reload, prepared
  dispatch, retry, mirror reconciliation, and hosted replay.
- An unmarked pre-feature Linq fixture with non-null contextual
  `replyToMessageId` remains flat after guarded serialization ships.
- A reaction with its existing operation and target still delivers without a
  native-reply marker.
- Message-intent dedupe or repair cannot promote flat to marked, marked to
  flat, or one reply target to another.
- A same-token message target or marker mismatch fails before provider
  preparation. Cover the ordinary exact token-hash match as well as the
  delivery-idempotency fallback lookup.
- A reaction may atomically settle to the last successful reaction/target only
  inside the exact existing unprepared pending/retryable window. Tests cover
  initial pending settlement, settlement after a known non-ambiguous failed
  attempt, and rejection while prepared or after send, delivery, or ambiguous
  confirmation.

### Provider and authority

- Linq emits one marker-authorized `reply_to.message_id` per marked standard
  message and omits `part_index`.
- Linq unmarked, null, SMS, RCS, missing-service, and unknown-service cases stay
  flat or fail before provider entry as specified.
- Target-event `reactionEligible` controls Linq reaction capability even when
  another grouped event has different metadata.
- Route revocation or wrong Linq group authority blocks both reply and reaction
  before their send endpoints.
- Local and hosted missing-chat paths never create a participant chat or send
  unthreaded for a marked reply. A failed standard attempt may leave an
  unattached uploaded asset.
- Linq voice-only selection fails before a message or voice-send endpoint.
  Text plus voice anchors text and sends voice through its existing endpoint.
- Telegram direct reply and reaction use the selected older message id.
- Each Telegram dash bubble receives the target. Existing first-chunk,
  image/media, and ambiguous-send behavior remains adapter-owned.
- The web-owned Linq client remains flat.

### Hosted-local scenarios

- Phase A compatibility: a synthetic marked Linq intent anchors after reload
  and retry, while an unmarked legacy intent with a contextual id stays flat
  and still passes hosted authority matching.
- Phase B iMessage direct: two accepted messages; reply targets the older one,
  reaction targets the newer one, and provider bodies prove both effects.
- Phase B iMessage group: interleaved visible messages; selected refs resolve
  to the correct senders' messages, while an unselected control stays flat.
- Phase B dash split: all intentional response bubbles carry the same native
  reply target.
- Phase B Telegram direct: reply and reaction independently target selected
  messages; unselected reply and progress stay flat.
- Negative Linq service: SMS/RCS exposes no selectable ref and cannot produce a
  provider effect through either tool.

## Verification

For each implementation phase and its separate PR:

- Run focused Vitest files for every touched owner and regression above.
- Run `pnpm test:diff <all touched paths>` after focused iteration. It owns
  touched-package and reverse-dependent typechecks.
- Run `pnpm verify:acceptance`; both phases change cross-package persisted
  state or behavior.
- Phase A: register and run
  `pnpm hosted-local e2e optional-native-reply-compatibility`.
- Phase B: register and run
  `pnpm hosted-local e2e message-targeting` for iMessage direct/group,
  Telegram direct, dash bubbles, reaction targeting, and negative Linq
  service behavior.
- Add both scenarios to the hosted E2E registry and required CI matrix.
- Run required completion audits and exactly one cross-cutting PR gate:
  ReviewGPT on each PR's exact pushed head, concurrently with CI.
- Run `git diff --check` and a privacy scan that rejects personal identifiers,
  provider ids, raw message data, and local paths in committed artifacts.

## Durable documentation to update during implementation

- `ARCHITECTURE.md`: shared accepted-message resolution, effect-local
  overrides, and the outbox as sole effect owner.
- `agent-docs/product-specs/optional-native-message-replies.md`: rename or
  broaden to document shared message targeting, supported actions, flat
  default, dash behavior, and failure behavior.
- `agent-docs/product-specs/index.md` and `agent-docs/index.md`: route the
  durable product spec.
- `agent-docs/SECURITY.md`: opaque refs and the provider-id privacy boundary.
- `agent-docs/RELIABILITY.md`: true-only marker, legacy replay, exact target
  retry, and rollback floor.
- `agent-docs/operations/imessage-deliverability.md`: both actions remain
  limited to reciprocal accepted conversations.
- `agent-docs/references/hosted-runtime-protocol.md`: additive reader rollout
  and provider-effect projection.
- `apps/cloudflare/DEPLOY.md`: Phase A rollout, exact fingerprint proof,
  rollback floor, and Phase B deploy checks.
- `agent-docs/references/testing-ci-map.md`: both hosted-local scenarios,
  commands, and CI ownership.
- Relevant package READMEs when public package contracts change.

## Explicit non-goals

- No group-only or direct-only product setting.
- No user preference, global reply mode, feature-flag service, or per-thread
  configuration.
- No provider message id in a prompt, tool argument, provider result, or
  diagnostic.
- No separate reaction and reply refs, `Input N` targeting, or new reference
  map.
- No combined generic message-action tool.
- No `nativeReplyToMessageId` parallel delivery field.
- No new reaction operation, send path, queue, outbox, sidecar, session field,
  database row, or web endpoint.
- No native effect against arbitrary history outside the exact accepted-input
  context.
- No SMS/RCS threading, Telegram group enablement, email threading change, or
  proactive/scheduled targeting.
- No fallback to latest message, flat delivery, or a new chat after target
  selection fails.
- No clear-selection action, reply-part targeting, or multiple reactions per
  context in v1.
- No orchestration layer for provider-internal text chunks or media parts.

## Success criteria

- A normal model response stays flat unless a valid reply selection exists.
- The model can reply or react to one exact accepted message using the same
  existing opaque reference in Telegram direct and Linq/iMessage direct or
  route-authorized group conversations.
- Every intentional dash bubble replies to the selected inbound message.
- Both actions revalidate the same stored event and use the same
  provider-private `deliveryReplyToMessageId` override.
- Reply and reaction selections remain independent and can target different
  messages in one context.
- Provider ids remain private, and runtime revalidates context, route, thread,
  actual service, action capability, and provider authority.
- Legacy Linq message intents stay flat; marked intents retry exactly and
  never fall back.
- Progress, typing, steering, transcript, routing, idempotency, mailbox
  ownership, and web-owned messages retain current behavior.
- Production adds only one reply-annotation tool, one required field on the
  existing reaction tool, one shared resolver with two narrow capability
  checks, target input metadata on existing provider results, one effect-local
  override path, and one optional true-only field on existing message intents.

## Planning evidence

- Audited accepted-input journals, prompt rendering, grouped and captureless
  admission, active-turn steering, provider result plumbing, reaction patches,
  reply-context overrides, dash bubbles, progress isolation, outbox identity
  and retry, local and hosted Linq fallback, Telegram chunk/media transport,
  hosted route authority, Cloudflare egress, and the commit that removed
  default Linq native anchors.
- Cross-checked current Linq protocol-selection, message-send, and voice-memo
  contracts on 2026-07-16.
- This planning branch changes no production code. Implementation remains
  pending in Phase A and Phase B.
