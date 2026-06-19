# Assistant Reactions

## Goal

Add a durable assistant reaction primitive without making reactions block text replies.

Success criteria:

- `react_to_message` records a reaction side effect for the current inbound message.
- A normal final assistant message can still be delivered after a reaction.
- `finish_without_reply` is the only explicit no-text terminal action.
- Reaction payloads flow through local delivery, outbox retry, and hosted side effects; channel delivery remains gated by real adapter support.
- Legacy message outbox intents still parse, while canonical persistence writes strict v2 payload objects.

## Architecture

Provider turns resolve to two separate concepts:

```ts
export type AssistantFinalAction =
  | {
      kind: 'message'
      response: string
      media: readonly AssistantResponseMedia[]
    }
  | {
      kind: 'none'
    }

export type AssistantReactionAction = {
  deliveryContextOrdinal?: number
  kind: 'current-inbound-message'
  reaction: AssistantMessageReaction
}
```

Rules:

- `react_to_message` appends or replaces the reaction side effect for the current inbound message.
- The reaction action snapshots the current delivery-context ordinal, so a reaction can target one inbound message while a later final reply targets another.
- `react_to_message` does not suppress final text.
- `finish_without_reply` sets `finalAction: { kind: 'none' }`.
- If Murph reacts and then sends final text, deliver both.
- If Murph reacts and then calls `finish_without_reply`, deliver only the reaction.

## Implementation Notes

- Codex dynamic tools return `reactionPatch` for `react_to_message` and `finalActionPatch: { kind: 'none' }` for `finish_without_reply`.
- Codex provider results include `reactions?: AssistantReactionAction[]`.
- Local service dispatches preceding replies, then reactions, then the final message when present.
- Reaction delivery requires a concrete inbound `replyToMessageId`; missing targets fail with `ASSISTANT_REACTION_TARGET_REQUIRED`.
- Channel adapters advertise `supportsReactions` only when runtime reaction delivery is actually implemented. Linq reaction support stays disabled until the runtime endpoint exists.
- Outbox v2 stores `payload.kind: 'message' | 'reaction'`.
- Legacy v1 outbox intents parse into v2 message payloads and expose top-level `message/media/subject` only as in-memory compatibility fields.
- Outbox write paths validate with the parsed schema but serialize stripped v2 persistence values, so compatibility fields are not written back to disk.
- Hosted side effects mirror the outbox payload union and keep a hosted `reactLinq` dependency boundary parallel to `sendLinq`.

## Tests

Coverage to maintain:

1. Dynamic tool parsing for `react_to_message` and `finish_without_reply`.
2. `react_to_message` returns a reaction patch and preserves final Codex text.
3. `finish_without_reply` suppresses final Codex text.
4. Reaction plus `finish_without_reply` keeps the reaction and suppresses text.
5. Local service dispatches reaction and final reply independently.
6. No-reply skips transcript and delivery when there is no reaction.
7. Outbox reaction payload identity and dedupe include target message id and reaction.
8. Outbox reaction dispatch uses the reaction channel path and rejects missing target message ids.
9. Non-reaction adapters reject reaction delivery.
10. Hosted side effects parse reaction payloads.
11. Hosted reaction payload plumbing stays covered while unsupported channel delivery fails closed.
12. Legacy message payload tests remain green.
Status: completed
Updated: 2026-06-17
Completed: 2026-06-17
