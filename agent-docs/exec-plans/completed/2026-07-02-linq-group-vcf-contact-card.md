# Linq Group Chat Contact Card Tool

## Goal

In a provisioned iMessage group thread, Murph should be able to notice that some
participants don't have their own Murph thread yet, send its contact card (.vcf) into
the group so they can tap/save/text it, and say so in its own voice ("add me as a
contact and shoot me a message, I'll get you set up"). The decision belongs to the
assistant, not to deterministic send machinery: expose it through the existing
`murph.group` dynamic tool. The existing 1:1 first-contact flow (signup link in DMs)
finishes onboarding when a non-member texts the line.

## Success Criteria

- `murph.group` gains `action="read_chat_participants"` (each group-chat participant
  handle plus whether they already have an active Murph membership) and
  `action="share_contact_card"` (sends a Murph .vcf as a Linq media attachment into
  this group chat).
- Both actions are authorized by the thread-route egress authority: the runtime
  injects `linqThread: { chatId, authority }` from the current wake's Linq delivery
  context; the web handler asserts the authority row, container/member match, and
  thread match before any Linq call. Without a valid authority the actions return
  `unavailable` (fail closed).
- The vCard carries the name "Murph", the murph_headshot.png photo (best-effort
  embed), the group's own line number as `mobile` (taken from the Linq chat roster's
  `is_me` handle — never a config guess), and a second healthy configured line as a
  labeled `backup` number (provider status not AT_RISK/CRITICAL from the synced
  `hostedLinqLine` rows; omitted when no healthy second line exists).
- Repeat `share_contact_card` calls are throttled server-side by the existing
  `hostedLinqContactCardShare` reservation table (48h per chat) and report
  `already_shared`.
- Direct 1:1 native contact-card share behavior and cadence are untouched.
- The group-chat skill and `murph.group` guidance tell Murph when to use the actions,
  with deliverability-safe framing (no signup/acquisition language; the join URL stays
  in the 1:1 DM flow; Murph still never initiates a thread).

## Constraints

- Reuse existing seams: the `murph.group` tool, `groupToolPort`, the internal
  `groups/tool` route with Cloudflare callback auth, `assertHostedThreadRouteEgressAuthority`,
  the contact-card reservation table, and the Murph card identity constants. No new
  routes, tables, tools, or delivery kinds.
- Raw chat ids and participant handles flow only through the already-authorized
  runtime path; the web DB continues to store hashed lookup keys only.
- vCard photo embed is best-effort; failures degrade to a photo-less card.
- Tool descriptions and skill copy must avoid acquisition/signup framing per
  `agent-docs/operations/imessage-deliverability.md`.

## Design

1. Contracts (`packages/hosted-execution/src/runtime-control.ts` + parsers): extend
   `HostedRuntimeGroupToolRequest`/`Response` with the two actions; requests carry an
   optional runtime-injected `linqThread` (chat id + Linq external-thread route
   authority). Responses: participants list with `hasOwnMurph` flag, or share result
   `sent | already_shared | unavailable`.
2. Engine (`packages/assistant-engine/src/assistant-codex/dynamic-tools.ts`,
   `assistant/system-prompt.ts`): add the actions to the model-visible schema and the
   `murph.group` description; the model never supplies `linqThread`.
3. Runtime (`packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts`):
   wrap `platform.groupToolPort` so the two new actions get `linqThread` injected from
   the initial mailbox Linq delivery contexts (first context with a route authority).
4. Web (`apps/web/src/lib/hosted-groups/group-tool.ts`): handle both actions after
   authority assertion. Roster via new `getHostedLinqChat` (GET `chats/{id}`) in
   `linq-client.ts`; membership via existing phone/email identity lookups + active
   access. Share: reserve attempt in `hostedLinqContactCardShare`, build vcf
   (`buildMurphHostedLinqContactCardVcf` in `linq-contact-card.ts`, photo from the
   Murph card image URL), upload via `POST attachments` + presigned PUT, send one
   `{ type: "media", attachment_id }` message part.
5. Skill (`packages/assistant-engine/skills/group-chat/SKILL.md`): first-exchange
   guidance — check participants, share the card once when someone doesn't have their
   own Murph, invite them to save it and text directly.

## Verification Plan

- Parser round-trip tests for the new request/response variants (hosted-execution).
- Engine tests: schema accepts the two actions, rejects extras.
- Runtime test: wrapper injects `linqThread` only for the new actions and only when a
  route-authorized Linq delivery context exists.
- Web tests: authority mismatch fails closed; roster membership classification;
  share happy path (attachment create → PUT → message send), throttled repeat, vcf
  content shape (CRLF, TEL from is_me handle, photo fallback).
- `pnpm test:diff` over touched paths + `pnpm typecheck`.

## State

Implemented and verified: contracts + parsers (strict, participants capped),
engine schema/description, runtime linqThread injection (iMessage-group
contexts only, distinct-authority fail-closed), web handlers (authority
assert, roster membership classification, vcf share with 48h reservation,
day-scoped idempotency key, 30s upload timeout, empty-roster fail-closed),
two-number vCard (mobile = chat's line, backup = first healthy pool line),
group-chat skill + hosted-groups prompt guidance. Focused suites green
(parsers 25, web group-tool 19, web contact-card 17, engine 6, runtime 4,
share/route 10); full `pnpm test:diff` lane green incl. apps/web and
apps/cloudflare verify; c1 Codex deep review (xhigh) findings all resolved.
Live-Linq shape of GET chats/{id} handles and vcf rendering still need a
production smoke after deploy (web before Cloudflare).
Status: completed
Updated: 2026-07-02
Completed: 2026-07-02
