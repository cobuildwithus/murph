# Shared Message Targeting

Last verified: 2026-08-05
Status: Implemented

## Decision

Murph has one accepted-message targeting primitive and two model-facing tools:

```text
murph.select_reply_target({ message_ref })
murph.react_to_message({ message_ref, reaction })
```

Both tools use the existing opaque `AssistantInputEvent.inputId` shown as a
`Message ref` in the current prompt. Both call the same resolver. They do not
share a generic action tool because selecting a reply target and sending a
reaction have different effects and lifecycles.

The feature has the same architecture in private and group conversations. It
is available only for accepted Linq input positively identified as iMessage
and accepted Telegram input with a valid numeric provider message target.
Ordinary automatic model messages remain ordinary flat replies.

## User behavior

`murph.select_reply_target` does not send anything. It optionally annotates the
normal response for its accepted-input delivery context. Murph should select a
target only when a native reply makes a busy conversation easier to follow.

The `---` delimiter still splits one response into several chat bubbles. Every
bubble from the same response segment inherits the same selected message. A
split response cannot partly target one message and partly target another.

`murph.react_to_message` sends the existing provider reaction effect to the
selected message. It does not select the target for the text response. A
reaction and a targeted reply may therefore coexist without sharing mutable
effect state.

## One reference and one resolver

The prompt renders `Message ref: ain_...` only when at least one targeting
action is eligible and all of these facts agree:

- the input is accepted in the current turn;
- the input is either positively identified Linq iMessage or Telegram with a
  valid numeric message id;
- the conversation source and reply-target channel match that source; and
- the stored input has a provider-native message id.

Linq SMS, RCS, and unknown service types expose no ref and are ineligible for
both tools.

The opaque input id is a selector, not authority. At tool execution, the shared
resolver must run only for the exact active root invocation. Resident child or
foreign-thread calls are rejected before accepted-message authority is
consulted. The resolver must then:

1. bind the call to its current accepted-input delivery-context ordinal;
2. require an exact accepted input id from that context;
3. reload the stored `AssistantInputEvent`;
4. recheck conversation, route, thread, direct/group audience, account, and
   group-actor authority, including an exact match between the event's provider
   reply thread and the current thread-kind binding; and
5. apply the action-specific native-reply or reaction capability policy.

The thread binding is the provider-route authority. A one-off explicit-target
override is not required for tool availability or resolution and does not
replace that binding.

The resolver fails closed for an invented, stale, cross-turn, cross-thread, or
unsupported ref. The tool result and provider-turn result carry only the
opaque accepted input id. The local delivery owner resolves the corresponding
provider message id again immediately before the effect.

Provider message ids never enter prompts, tool arguments, tool results, model
history, or diagnostics. There is no second ref map, provider-id registry,
database projection, service, API, or feature flag.

## Delivery and persistence

The delivery owner clones the selected input's existing reply-delivery context.
It does not mutate the shared accepted input. This keeps response segments and
reactions isolated even when several inputs joined one live turn.
Same-route inputs accepted during that turn may update their message anchor,
reaction capability, and idempotency inputs, but do not replace the current
thread binding or create an explicit-target override.

Reactions keep the existing `message-reaction` outbox operation, retry policy,
and provider adapter. The only behavior change is that its target comes from
the shared accepted-message resolver instead of being assumed to be the newest
inbound message.

When `finish_without_reply` follows a successful reaction selection, the
provider's recorded reaction patch is the crash-fence authority. Suppression
evidence waits for the reaction delivery outcome even if target authority or
stored input changes before final settlement; the runtime does not recompute
mutable eligibility to decide whether delivery work is pending.

An intentional automatic model native reply is a normal message outbox intent
with:

```text
nativeReplyRequested: true
replyToMessageId: <private provider message id>
```

`nativeReplyRequested` is a true-only marker. It is part of strict parsing,
persistence, fingerprints, equality, and dedupe. This marker is necessary
because automatic Linq replies already carry contextual `replyToMessageId`
values for routing and history. Those existing values do not request a native
reply from automatic model delivery. An unmarked automatic model intent
therefore remains flat.

Each delimiter-generated bubble gets its own normal outbox intent and copies
the same marker and provider target. A retry preserves that pair. A reaction
never receives the marker.

## Provider behavior

- Linq serializes `message.reply_to.message_id` only for a marked normal
  message. A marked send must retain the selected chat and cannot recover by
  creating a different direct chat.
- For automatic model delivery, Telegram passes the selected message id through
  its existing native reply field when the normal message is marked. Existing
  explicit or manual low-level native-reply calls keep their prior behavior.
- Unsupported channels expose no message refs and fail closed if a stale
  provider thread attempts an action.
- Linq native reply selection requires text to carry the target. A voice-only
  selected response fails before delivery. A text-plus-voice response anchors
  the text; the existing voice-memo endpoint remains unthreaded.

## Rollout and rollback

The reader and writer ship in one runner bundle. Deploy Cloudflare and the
runner with `container_rollout=immediate`, then require managed-container smoke
to report the exact new runner-bundle fingerprint and prove its assistant CLI
surface contract before accepting targeted work. `apps/web` has no ordering
dependency.

Rollback to the prior bundle is safe only before the first marked outbox intent
is written. After that point, the new bundle is the hard rollback floor because
a workspace, checkpoint, or retained outbox intent may contain the strict
marker. Do not try to prove an incident-time drain; use a forward fix on that
bundle or newer. No compatibility reader, dual writer, or second rollout phase
is added.
