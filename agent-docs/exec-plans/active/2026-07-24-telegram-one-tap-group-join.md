# Telegram one-tap group join

## Outcome

A Telegram group member joins a Murph group and grants the offered health-data
disclosure with one tap on an inline button attached to the offer message, with
no context switch out of the chat. iMessage/Linq reaction joins keep working
byte-for-byte.

## Why

Linq exposes a one-tap join: heart the offer message and the reaction grants
membership plus the offered projection scopes. Telegram members get a hosted web
link instead, and the assistant currently tells them reacting is impossible.
Telegram only delivers `message_reaction` updates when the bot is an
administrator of the chat, which Murph is not in ordinary groups, so native
reactions cannot be the Telegram primitive. An inline-keyboard `callback_query`
button needs no administrator rights and carries a stable target message plus an
identified actor.

## Design

The offer message itself is the binding token. A `callback_query` carries
`message.chat.id` and `message.message_id`, which is the same identity the Linq
reaction path already matches on, so no dispatch record, opaque token, or
prepare/finalize protocol is required. Telegram becomes structurally identical
to Linq:

    post_join_offer -> send card + inline keyboard -> capture message_id
                    -> recordHostedGroupJoinOfferTx(telegram message key)

`apps/web` gains `TELEGRAM_BOT_TOKEN` so it owns the Telegram send exactly as it
already owns the Linq send. No new tables, no new lifecycle state.

Existing seams reused instead of new ones:

- `assertHostedThreadRouteEgressAuthority` is already channel-generic; the Linq
  variant is a thin wrapper. Telegram reuses the generic assert.
- `createHostedLookupKey` namespaces the blind index, so a Telegram message key
  is a new namespace, not a new column. `messageLookupKey` stays generic.
- The join and disclosure acceptance transactions stay the only grant authority;
  only the hardcoded `channel: "linq"` route lookup is parameterized.

## Scope

- `apps/web` env + Telegram send/answer client.
- Telegram message blind-index lookup key.
- Channel parameterization of the join/disclosure offer record + accept paths.
- `callback_query` ingress parsing and handling.
- Channel-aware `post_join_offer` / `post_disclosure_request` offer thread context.
- Channel-aware offer copy, group-chat skill text, and `murph.group` description.

## Invariants

- Reaction removal never revokes; revocation stays an explicit hosted action.
- A callback grants only when token-free identity agrees: exact chat + message
  binding, active unrevoked offer, live thread route owned by the group runtime
  member, resolved non-suspended member with active access.
- Chat-affirmation joins keep the historical (version-blind) launch consent
  assert; missing consent still fails closed.
- Bot actors, anonymous `actor_chat`, and aggregate reaction counts never map to
  a member identity.
- `murph.group` description edits rotate the Codex contract fingerprint; deploy
  the transport and backend before the description change.

## Known and accepted

Replayed provider events can re-run a join. The ledger records "received", not
"applied", so gating on it would silently drop legitimate joins after a
transient accept failure. Fixing it properly needs a consumed-event record;
deliberately deferred rather than adding machinery. Documented in
`agent-docs/RELIABILITY.md`.

## Status

Landed so far (inbound half, green):

- Channel-neutral `acceptHostedGroupOfferAffirmation` owns offer matching, the
  acceptance transactions, and the post-commit tail for both channels.
  `join-offer-reaction.ts` is now the Linq adapter over it.
- `createHostedTelegramMessageLookupKey` keys on `(chat_id, message_id)`.
- `callback_query` is modelled and validated in `messaging-ingress`;
  `buildTelegramThreadId` accepts a callback message so a tap resolves to the
  same thread id as the card.
- `handleHostedTelegramGroupOfferCallback` grants from a tap and answers the
  callback; wired into the Telegram webhook outside the planning transaction.
- `apps/web` Telegram send/answer client behind `TELEGRAM_BOT_TOKEN`.

Remaining (outbound half, nothing user-visible until done):

1. `HostedRuntimeGroupToolTelegramThreadContext` on `post_join_offer` /
   `post_disclosure_request` in `packages/hosted-execution/src/runtime-control.ts`
   plus its parser. Web must accept the existing `linqThread` shape during the
   deploy window.
2. A Telegram thread-context resolver beside
   `resolveHostedGroupToolLinqThreadContext` in `workspace-assistant-phase.ts`.
   Web cannot derive the chat id itself: `HostedThreadRoute` stores only blind
   indexes, so the runtime must supply it exactly as it does for Linq.
3. Channel-aware authorize + send in `group-tool.ts`, reusing the already
   channel-generic `assertHostedThreadRouteEgressAuthority`.
4. Channel-aware offer copy and button labels, group-chat skill text, and the
   `murph.group` description (rotates the Codex contract fingerprint).

## Verification

Focused owner suites for the touched packages plus `pnpm test:diff` over the
changed paths.
