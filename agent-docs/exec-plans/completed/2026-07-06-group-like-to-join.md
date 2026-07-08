# Group like-to-join with scoped health sharing (Linq v1)

Our utmost priority is clean, simple, long term maintainable and composable architecture with minimal complexity.

## Goal

Let a person who already has Murph join a Murph group chat, and share the group's stated health projections, by liking one offer message in the thread. No website step for existing members. The web join page remains the path for strangers (signup + launch consent) and for fine-grained share management.

## Why

Group joins and share grants currently require opening `/groups/join/[joinCode]` in a browser. Inside an active group chat that is needless friction: the thread context already binds the group, and the sender handle is already transport-authenticated. Linq delivers `reaction.added` webhook events (verified against docs.linqapp.com 2026-07-06: `message_id`, `chat_id`, `part_index`, `reaction_type`, `from_handle`, `reacted_at`; works in group chats), so a like on a specific offer message is a deterministic, attributable affirmative act.

## Design decisions (locked with product owner, 2026-07-06)

1. No generic action table or handler registry. The join authority stays `HostedGroup.joinCode` + `joinPolicyJson`; the offer binding is columns on `HostedGroup`. Extract a general primitive only when a second real consumer exists.
2. A like grants membership + `profile-name.v0` + the projection kinds snapshotted at offer post time. Additive only: a reaction accept never revokes or narrows existing grants.
3. Changing what likes grant requires posting a new offer message (snapshot freeze is the honesty guarantee: people grant what the message they liked actually said).
4. Accepted reactions: Linq tapback `like` and `love`, plus `custom` reactions whose emoji normalizes to 👍 or ❤️ (strip variation selectors and skin-tone modifiers). This keeps the allowlist forward-compatible with Telegram, whose reactions are plain emoji.
5. `reaction.removed` is ignored (no un-join / un-share by unlike). Revocation surface is the join page, which already grants/revokes on re-accept.
6. No LLM at trigger time. The reaction path is deterministic webhook-side dispatch. Model judgment happens once, at offer creation, where the human can read and object.
7. Grant scope comes from structured tool input, never from message prose. The tool renders the what-you-share sentence from validated kinds; prose and grant cannot drift.

## Data model

Four nullable columns on `HostedGroup` (`apps/web/prisma/schema.prisma:1034`), plus migration:

- `joinOfferMessageLookupKey` (unique) — HMAC blind index of the offer's Linq message id, via the existing `contact-privacy-core` helpers (`apps/web/src/lib/hosted-onboarding/contact-privacy-core.ts:114`). Never store raw chat/message ids or handles.
- `joinOfferMessageIdSuffix` — display/debug suffix, matching `HostedLinqDelivery` conventions (`schema.prisma:1206`).
- `joinOfferProjectionKindsJson` — snapshot of offered kinds, validated against the selectable-kind normalizer (`apps/web/src/lib/hosted-groups/join-policy.ts:145`). `profile-name.v0` is implicit membership sharing and never listed.
- `joinOfferPostedAt`.

Lifecycle: binding is valid only while the group's `joinCode` is set and unchanged. Re-posting an offer replaces the binding. Wherever `joinCode` is cleared or rotated, clear the offer columns in the same transaction.

## Offer posting: new group tool action `post_join_offer`

- Contract action beside `create_join_link` in `packages/hosted-execution/src/runtime-control.ts:766`; chat-scoped Linq thread context injection in `packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts:201` (same as `share_contact_card`); handler in `apps/web/src/lib/hosted-groups/group-tool.ts` following the `share_contact_card` shape (`group-tool.ts:351`): owner-only authorization, authorized thread send via `sendHostedLinqChatMessage`, which already returns `messageId` (`apps/web/src/lib/hosted-onboarding/linq-client.ts:62`) — keep it instead of discarding it.
- Input: `projectionKinds` (subset of selectable kinds; may be empty) and optional model-composed intro prose. The handler ensures a `joinCode` exists (reuse `createHostedGroupJoinLinkForOwnedThreadContainerTx` guts, `group-store.ts:238`), appends a deterministic scope sentence rendered from the validated kinds, sends, and records the binding + snapshot in one transaction.
- Copy: follow `agent-docs/operations/imessage-deliverability.md`. No em dashes. State plainly what a like shares; include that sharing can be changed anytime.
- Check whether the Cloudflare group-tool port (`apps/cloudflare/src/runtime-platform/group-tool-port.ts:14`) is a generic passthrough or enumerates actions; wire if needed.

## Ingestion: `reaction.added` as a supported provider event

- Add `reaction.added` to `apps/web/src/lib/hosted-onboarding/linq-provider-events.ts:24` (currently `message.received`, `message.delivered`, `message.failed`, `phone_number.status_updated`). Parse `message_id`, `chat_id`, `reaction_type`, `custom_emoji`, `from_handle`, `service`, `reacted_at`; compute lookup keys. Follow the existing provider-event idempotency/dedupe pattern.
- Branch in `apps/web/src/lib/hosted-onboarding/webhook-service.ts` (~`:130-146`) alongside the existing non-`message.received` handling. The planner's early ignore of non-message events (`webhook-provider-linq.ts:144`) must not swallow reactions.
- Handler flow: reaction allowlist check → lookup live offer by `(chat lookup key, message lookup key)` → resolve `from_handle` to an active hosted member via existing blind-index resolution → accept (below) → deterministic confirmation message in-thread.
- Every non-accept outcome records a skip reason (`unsupported_reaction`, `no_offer_match`, `not_a_member`, `launch_consent_missing`, `reaction_removed`, ...) — observable outcomes per `docs/contracts/00-invariants.md:61`; no silent drops. No outbound messages to unresolved handles (cold-contact protection).
- Subscribe the local harness tunnel to `reaction.added` (`packages/hosted-local-harness/src/dev-hosted-local/linq-webhook-tunnel.ts:15`, `:298`).

## Accept semantics

Reuse `acceptHostedGroupJoinCodeTx` (`apps/web/src/lib/hosted-groups/group-store.ts:343`) — it already enforces launch-required consent, membership idempotency (`[groupId, memberId]`), share limits, and kind validation. Two adjustments:

1. Entry point that accepts a resolved member + the snapshot kinds instead of a web session + live-policy selection.
2. Additive-only share semantics for the reaction path: grant the union of existing grants and snapshot kinds; never revoke. Parameterize the tx or compute the union at the callsite, whichever is smaller. The web path's grant/revoke behavior is unchanged.

Existing members who like a wider offer are additively upgraded (locked decision 2).

## Contracts and confirmation

- Update the "optional health permissions are approved only through server-owned join pages" language in `packages/assistant-engine/src/assistant/system-prompt.ts:315-318` and `packages/assistant-engine/src/assistant-codex/dynamic-tools.ts:312-345` to include server-owned offer messages. This trips the `staticPromptHash` tripwire in `packages/assistant-engine/test/model-behavior.test.ts` — update the pinned hash deliberately, as its own reviewed hunk.
- Confirmation send: deterministic web-side template following the `family_invite_reply` shape in `apps/web/src/lib/hosted-onboarding/webhook-transport.ts:163` (new template, e.g. `group_join_offer_accepted`). Copy pattern: "Added <name>. Sharing <kinds> with this group. Manage what you share anytime: <join link>". Verify every claim in copy against code before writing it (the join link page is the real revocation surface today).
- The runtime is not woken by an accept; the roster is read from Postgres via `read_current`, so the group runtime sees new members on its next turn.

## Verification

- Unit: reaction event parsing + allowlist normalization (tapbacks, 👍/❤️ with variant selectors/skin tones, rejected kinds); offer binding lifecycle (post, re-post replaces, joinCode rotation clears); accept matrix (member joins, stranger skip, no-consent skip, repeat like idempotent, like on non-offer message, additive-union upgrade for existing member, `reaction.removed` ignored).
- Hosted-local e2e: post offer via group tool → simulated `reaction.added` webhook → assert membership + `HostedVaultShare` rows + confirmation egress + skip-reason telemetry for a stranger reaction. Note: the Prisma AI-consent guard blocks hosted e2e from Claude-spawned shells; run via Codex.
- Focused web tests for the webhook service branch and group-store changes; run from repo root via `apps/web/vitest.workspace.ts`.

## Deployment

1. Deploy web first: unknown `reaction.added` events are already ignored (`ignored-event-type`) by the old code, and the new code tolerates the subscription not existing yet.
2. Then add `reaction.added` to the Linq webhook subscription (managed outside the repo — via the Linq partner dashboard/subscriptions API; document the exact step in this plan when performed).
3. If the Cloudflare group-tool port needs changes for the new action, deploy web before Cloudflare.

## Non-goals (v1)

- Telegram triggers (group ingestion is not wired for Telegram at all; the emoji allowlist keeps the door open).
- Reply-keyword trigger ("reply 'in'") — same accept entry point can serve it later.
- Un-join / un-share on `reaction.removed`.
- Newsletter or any second action kind; no generic action table/registry until a second consumer exists.
- Granting legal consent (`launch.legal` / `launch.health-data`) by reaction — never; strangers use the web join page.

## Open items for the implementer

- Verify the live `reaction.added` payload shape against a real event before finalizing the parser (docs read 2026-07-06; no repo fixture exists yet).
- Confirm where the Linq webhook subscription is managed and record the ops step here.
- Confirm `group-tool-port` passthrough behavior for new actions.
- Coordinate with the active `2026-07-06-group-challenge-referee` lane if it touches `group-tool.ts` / `group-store.ts`.
Status: completed
Updated: 2026-07-06
Completed: 2026-07-06
