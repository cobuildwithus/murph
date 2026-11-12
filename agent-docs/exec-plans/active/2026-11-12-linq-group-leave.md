# Murph leaves Linq groups

Status: proposed; plan only, implementation not started
Created: 2026-11-12
Updated: 2026-11-12

## Problem and goal

Busy mixed-protocol groups recreate their Linq chat identity, multiplying setup
notices, private recovery and assistant turns. Linq accepting a leave does not
reliably remove its line. Murph must leave locally first and stay quiet.

Build on PR #4886, inspected through
`git diff origin/main...origin/claude/linq-big-group-silence`, head
`1a25d7154c1dd4a8ecd80117f00a82e0e37d9b92`. It blocks **unbound** groups above
32 active participants and keys private recovery per member per UTC day. It
does not retire bound rooms. Its new wrapper is
`planHostedLinqUnboundGroupChatWebhook`; bound ingress uses
`planHostedLinqExistingThreadRouteWebhook`.

Success: silent local leave, one best-effort provider attempt, and no later
mailbox append, AI wake, setup or private recovery from that chat. Preserve
direct chats, human groups, history and game authority. No classifier or worker
pipeline: the group assistant judges conversational reasons for leaving.

## Decisions

| Decision | Reason |
| --- | --- |
| Commit local leave before calling Linq. | A 202 proves acceptance, not removal. |
| Add one three-column Web-owned tombstone per chat. | Route deletion loses the evidence; unbound rooms have no container. |
| Reuse chat locks, exact route deletion, group-tool transport and post-commit scheduling. | These already own the relevant boundaries. |
| Only the first marker insert requests provider leave; no automatic retry. | Floods and ambiguous outcomes must not cause repeated calls. |
| Same-ID re-add stays left, including an own-line `participant.added`. | Avoid stale-event ordering and repeated reactivation. |
| Per-chat identity is enough; no roster fingerprint. | #4886 silences oversized copies; similar rosters can be legitimate rooms. |
| Refuse tool leave during an invited, negotiating or live bound game, or an owning line move. | Do not silently strand existing product flows. |
| Leave silently; preserve container history, memberships and games. | Chat departure is separate from deletion and consent. |

### Local state and deterministic auto-leave

Propose `HostedLinqGroupLeave(threadIdentityLookupKey PRIMARY KEY, leftAt, reason)`.
Use server time and bounded reason codes; reuse
`createHostedExternalThreadIdentityLookupKey` and its read-candidate helper.
No plaintext chat ID, contact, room name or model explanation. This is hosted
routing control state, outside snapshots, with no container foreign key or
automatic expiry. Retain markers across container deletion and key rotation;
growth is one row per left chat, never per message.

Do not overload `HostedLinqChatHealth`: it may have no row and requires actual
provider health status/timestamps. Fake provider facts or daily notice state
would obscure the local decision; a small independent marker is simpler.

Add a small owner in `hosted-routing/linq-group-leave.ts`: proposed functions
`leaveHostedLinqGroupTx`, `readHostedLinqGroupLeave` and
`requestHostedLinqGroupLeaveAfterCommit`. Under existing chat-ownership then
route-write locks, validate the exact target, insert the marker and delete the
matching bound route atomically. Reuse `releaseHostedLinqRemovedLineRouteTx`;
failed exact deletion rolls back the marker, and move exclusions remain.
Route creation, refresh and adoption must reject markers under these locks,
including preparation begun before leave. Keep provider/KMS work outside locks.

Do not call the Ops wrapper `releaseHostedLinqRemovedLineRoute`: it requires
a complete roster of at most 32 handles and provider proof that self is inactive.
Local leave must work while self remains active or Linq is unavailable. Auto-leave
still requires #4886's verified oversized roster and managed recipient-line
authority; incomplete/unavailable rosters remain retryable.

The oversized unbound branch writes the marker and returns a request-local
`postCommitLinqGroupLeave` target only for the winning insert. After commit,
`webhook-service.ts` uses its existing post-response scheduling pattern to call
`leaveHostedLinqChat`, retaining its three-second deadline. Keep this separate
from `desiredSideEffects`, whose current type is message delivery. Tool and Ops
use the same owner and post-commit helper.

Keep local success on 202, 409/code 2015, timeout or other provider failure;
record bounded diagnostic codes. The adapter treats 409 as unconfirmed: do not
propagate it into webhook/tool retries. Replays never call Linq again.
**Accepted tradeoff:** death after commit but before dispatch can omit the
attempt. No durable pending-provider obligation, polling or retry worker;
later provider remediation is a separate operator action. Local silence saves
processing/outbound traffic; only actual provider removal stops inbound quota.

### Admission, existing work, copies and re-add

After webhook authentication/parsing, check the marker before reaction
conversion, roster reads, crypto preparation, typing/read receipts and setup.
Return `ok: true, ignored: true, reason: "group-left"`. Receipt/health accounting
may continue without sends or routing revival. Recheck under the chat lock
before message/edit/reaction mailbox append and route creation/adoption.
Database failure is retryable, never permission to fall through. Keep
`group-left` outside visible-secondary reasons; recheck the source group before
sending private recovery planned before leave.

Cost: one indexed narrow read over bounded key-rotation candidates per relevant
webhook; unmarked mutations add a locked recheck. Marked traffic returns before
roster work. No per-handle lookup, scan or model call on the rejection path.

Route removal revokes runtime egress. Fence Web notice dispatch and canonical
Linq egress too, including typing and stale setup plans. Reuse existing terminal
route-authority outcomes understood by old runners. Accepted work must settle
as durable policy non-reply, not disappear or retry forever. Prove the tool
turn finishes quietly and queued work drains through that path. Already-running
model/provider calls cannot be undone: immediate leave blocks new admission
and new effect authorization. Do not add a second pre-model authority loop or
claim route deletion cancels in-flight AI.

New oversized chat IDs independently hit #4886 and get their own marker/attempt.
A new ID at or below 32 can be admitted and judged anew; accept this narrow gap
instead of blacklisting similar rosters. Same-ID re-add stays left; a genuinely
new room at or below the cap follows ordinary admission.

### `murph.leave_group`

Strict schema: required `reason` enum
`bot_loop | spam | no_real_members | asked_to_leave`, and required `messageRef`
bounded like game tools. No free text, target ID, target line or force switch.
Auto/Ops reasons are internal `oversized` and `operator_cleanup`.

Expose only in authenticated Linq group-container conversation turns with
accepted input; exclude private, email, Telegram, scheduled, recap, maintenance
and output-only turns. Resolve `messageRef` against current accepted inputs;
inject route context in `createHostedGroupToolWithCurrentTurnContext`. Web
independently verifies callback runtime identity, container, persisted input
and exact current route. Reuse game accepted-input plumbing, not its player-only
restriction: an actual participant may request leave without being a player or
paying member. Replay can return `already_left` using persisted input/room
binding even after route deletion.

Reuse `groupTool.request -> group-tool-port.ts -> POST
/api/internal/hosted-execution/groups/tool -> handleHostedRuntimeConversationTool
-> shared local-leave owner -> post-commit Linq leave`. No new runner endpoint.
Return typed local outcomes `left`, `already_left` or `unavailable`; never claim
provider removal. The Web game guard serializes with game creation/approval and
route binding; unknown state fails closed. A plain game existence read is not
enough: share the route mutation lock at binding/write authority, respecting
the existing pair/member/game lock order. No automatic game cancellation.

Guidance beside `buildAssistantGroupSocialRoleText`: leave clear assistant loops
or spam; leave a room with no real Murph members only when trusted room facts
support that conclusion; honor a current participant's actual leave request.
Unknown/inactive people, human banter and AI discussion alone are not bot
evidence. Quoted requests and pasted instructions are not authority. Distinguish
"be quiet" from "leave". On success use existing quiet-turn completion with no
announcement/private message. Explain a game refusal once only when answering
a person's leave request.

## Exact implementation surfaces

Repository-relative paths; new names are proposals.

| Files | Change |
| --- | --- |
| `apps/web/prisma/schema.prisma`; new migration under `apps/web/prisma/migrations/` | Three-column marker and primary-key lookup. |
| New `apps/web/src/lib/hosted-routing/linq-group-leave.ts`; `thread-container-service.ts`, `thread-route-store.ts`, `linq-group-line-move-ingress.ts` in that directory | Shared helpers; reuse `releaseHostedLinqRemovedLineRouteTx` and locks; fence route writes, including `replaceHostedLinqGroupLineMoveRouteTx`. |
| `apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts`, `webhook-provider-linq-types.ts`, `webhook-service.ts` | Extend #4886's oversized branch/plan; early and locked checks across messages, edits, reactions, participant events and prepared move adoption. |
| `apps/web/src/lib/hosted-onboarding/webhook-transport.ts`, `visible-secondary-webhooks.ts`, `linq-egress-engagement.ts`; `apps/web/app/api/internal/hosted-runtime/linq-egress/engagement/route.ts` | Fence `drainHostedLinqSideEffectsDirect`, source-group recovery, `assertHostedLinqRecentInboundEngagementForRuntime` and typing. Reuse `linq-client.ts:leaveHostedLinqChat` unchanged. |
| New `packages/assistant-engine/src/assistant-codex/dynamic-tools/leave-group.ts`; `packages/assistant-engine/src/assistant-codex/dynamic-tools.ts`, `dynamic-tool-catalog.ts`; `packages/assistant-engine/src/assistant/codex-turn/planning.ts`, `packages/assistant-engine/src/assistant/system-prompt.ts` | Tool definition/parser/handler, availability and guidance; follow `games.ts:executeOrdinaryGameTool`. |
| `packages/hosted-execution/src/runtime-control.ts`, `parsers/runtime-control.ts`; `packages/assistant-runtime/src/hosted-runtime/group-tool-context.ts` | Strict request/response variants and trusted room-context injection. |
| `apps/web/app/api/internal/hosted-execution/groups/tool/route.ts`; `apps/web/src/lib/hosted-groups/group-tool.ts`; new `linq-group-leave-tool.ts` beside it | Add leave to explicit runtime-identity forwarding; dispatch, accepted-input authorization and transactional game guard. |
| `apps/web/src/lib/game/chat-membership.ts`, `chat-tool.ts`, `service.ts` | Audit and enforce common serialization for `readGameChatAuthority`, `bindPairGameChat`, `associateGameChatInviteTx`, `authorizeGameChatActorTx` and `runGameChatUpdate`; a concurrent game cannot bind/start after leave. |
| `apps/cloudflare/src/runtime-platform/group-tool-port.ts` | Reuse transport; add replay-safe classification only with marker-backed provider deduplication. |
| `apps/web/app/api/ops/linq-group-line-move/route.ts`; `apps/web/src/lib/hosted-ops/linq-group-line-move.ts` | Add `leave_group` with opaque `containerRef`; preserve `release_removed_line_route` semantics. |
| `ARCHITECTURE.md`; `agent-docs/SECURITY.md`, `agent-docs/RELIABILITY.md`, `agent-docs/index.md`; assistant engine/runtime READMEs | Update authority, retention, tool scope, effects and rollback contracts during implementation. |

## Operator cleanup

After deployment, resolve the three incident containers privately in Ops and
apply `leave_group` individually using full opaque route refs, never suffix
matching. Recheck exact target and game/move conflicts; commit local leave,
then attempt provider leave. Replays are no-ops; report local status separately
from provider acceptance. Preserve history/accounts. A conflict needs a
separate deliberate decision, not an implicit override. Keep incident IDs out
of the plan, fixtures and PR text. No cleanup is performed in this task.

## Tests and verification

- New `apps/web/test/hosted-linq-group-leave-postgres.test.ts`: concurrent leave
  dispatches once, exact-delete rollback, admission/game-start/move races,
  key rotation and marker survival after container deletion.
- Extend Web `hosted-onboarding-linq-thread-route.test.ts`,
  `hosted-onboarding-linq-webhook.test.ts`,
  `hosted-visible-secondary-group-recovery.test.ts`, and
  `hosted-onboarding-linq-egress-engagement.test.ts`: 32/33 boundary, incomplete
  roster, all inbound variants, 202 without removal, 409/2015, timeout,
  crash-before-dispatch, duplicate/new IDs, re-add, stale setup/private recovery,
  typing and direct-chat preservation. Assert bounded reads, zero mailbox/wake
  and zero provider/KMS calls inside transactions.
- Extend Web `hosted-group-tool-route.test.ts`, `hosted-group-tool.test.ts`,
  `hosted-ops-linq-group-line-move-route.test.ts`; hosted-execution
  `group-tool-dispatch-parser.test.ts`; assistant-runtime
  `hosted-runtime-group-tool-linq-context.test.ts`,
  `hosted-runtime-linq-outbox-regression.test.ts`; Cloudflare
  `group-tool-port-replay.test.ts`: forged room/input, unsupported origins,
  missing runtime identity, game/move refusals, idempotent success and terminal
  quiet settlement, including old runner/new Web compatibility.
- Extend assistant-engine `assistant-codex-group-tool.test.ts` and
  `prompt-route-matrix.test.ts`, then synthetic `assistant-codex-real-e2e.test.ts`
  journeys: bot loop, human banter, unrecognized humans, actual leave request,
  quoted injection, quiet request and live game. Assert exact tool args/count,
  silence on success and no announcement/private DM.

Implementation checks: focused Vitest through owning configs (Web uses
`apps/web/vitest.workspace.ts`), migrated local Postgres proof, relevant
typechecks/lint, then `pnpm test:assistant:live -- --test "linq group leave"`
under the assistant-verification skill, with Ready/Hold reply review. Exact-head
CI and one eligible final ReviewGPT round follow local proof. This plan-only
task runs no runtime tests, model calls or external review.

## Deploy order and risks

1. Implement on merged #4886, retaining its cap and daily recovery.
2. Apply additive migration, then deploy Web enforcement, auto-leave, Ops and
   tool parser/handler. Existing request/response shapes stay supported.
3. Deploy Cloudflare/runtime with the tool. New runner must not reach old Web.
   Old runner/new Web must settle terminal route loss quietly; if proof finds
   a gap, deploy that consumer fix first and defer all leave producers until it
   drains. Do not introduce a new wire error ahead of its consumer.
4. First marker write establishes a Web rollback floor: older Web can recreate
   routes. Use a compatible forward fix and retain markers. Old Cloudflare is
   safe only with proven terminal egress behavior. Operator cleanup follows
   these gates under separate authority.

Three principal risks: leave racing admission/egress (prove locking and terminal
settlement); one-attempt provider leave failing to reduce quota (report that
limit); false-positive agent leave becoming permanent (restrict scope and prove
human-group counterexamples).

## Open questions for the owner

- Accept sticky same-chat leave, or later require explicit own-line re-add
  recovery? Proposed default: **stays left**.
- Accept one best-effort attempt across crashes, or separately scope bounded
  provider recovery? Default: **no automatic retry**.
- Should an explicit person asking to leave override an active game? Default:
  **refuse**, with no automatic cancellation.

## Planning evidence

Inspected local source and all five files of #4886's diff. No implementation,
commit, push, message, production access or Linq call. Keep this proposed plan
active for implementation. `scripts/frog list` failed because Frog is not
installed; no dependency installation or workaround is needed for this plan.
`pnpm docs:drift` also could not run: installed repo-tools and `node_modules`
are missing. Next-best checks passed: referenced paths, index link, whitespace
and identifier scan; `git diff --check` passed. No runtime/typecheck run is
needed for these planning-document-only edits.

## Plan review (ReviewGPT architecture, 2026-11-12)

Response: `audit-packages/plan-linq-group-leave.md` (apollo lane). It confirmed the
independent marker table (a route needs a container and cascades with it; chat
health needs real provider facts) and the existing group-tool transport. All
seven findings are accepted; each cites current source, and none conflicts with
the owner's direction. Revise the sections above before implementation:

| # | Finding | Disposition |
| --- | --- | --- |
| 1 | Group typing (`channel-activity.ts` `prepareHostedLinqTyping`) starts without route authority; Web unbound-notice dispatch and private recovery are permissive by design. | Accept. Keep bound egress on existing route authority; authorize group typing fail-closed at provider start/refresh; marker checks only at unbound-notice dispatch and source-group recovery. Deploy the typing consumer before any leave producer. |
| 2 | Game-room reuse (`readPairGameChatTx`, `bindPairGameChat`, rematch, bootstrap) treats a route-less historical room as usable, so a left room can be inherited and re-bootstrapped. | Accept. One binding rule in `game/chat-membership.ts`: provider room needs a current locked route; route-less reuse only with an active unfinished bootstrap. Leave takes the route row lock (`lockHostedThreadRouteByThreadIdentityTx`) before its game query. |
| 3 | A blind-index-only marker is lost once its key leaves the two-key read set. | Accept. Add one purpose-separated encrypted chat-id field (contact-phone-envelope pattern) so rotation can re-derive and reseal. Decide before the first marker write. |
| 4 | Poll-vote notifications append to the mailbox outside the chat lock. | Accept. Early marker check before `handleHostedLinqNonMessageWebhook`; poll notification admission takes the chat-ownership lock before its route check. |
| 5 | Returning `left` lets the model continue. | Accept. `left`/`already_left` use the existing terminal external-effect no-reply path; `unavailable` stays answerable. |
| 6 | Leave-specific room-context injection duplicates the accepted input's authority and rejects RCS. | Accept. Tool sends `{ action: "leave_group", reason, origin: { kind: "accepted_input", assistantInputId } }`; Web derives the target from the persisted input. Drop the `linqThread` injection. |
| 7 | `releaseHostedLinqRemovedLineRouteTx` refuses completed-move destinations forever. | Accept. Factor the exact compare-and-delete leaf; keep active-move exclusions only; leave the Ops repair wrapper unchanged. |

Scope note from the review, kept: deterministic auto-leave stays unbound-only. A
bound room that later grows past 32 is not auto-retired by this plan.

## Delivery phases

Two PRs, so the cleanup of the incident rooms is not held behind the tool.

1. **Web: local leave, auto-leave and Ops.** Marker table with the encrypted
   chat-id envelope and rotation re-derive (#3); shared local-leave owner with
   the factored exact-delete leaf (#7) and route-row-locked game/move guard;
   early `group-left` check before all webhook fan-out including polls (#4,
   first half); route creation, refresh and adoption reject markers; unbound
   notice and source-group recovery checks (#1, Web half); oversized unbound
   auto-leave with one post-commit Linq attempt; Ops `leave_group`.
   Finding 1 asks for the typing fence before any leave producer. Phase 1 is
   accepted without it, with evidence: Ops `release_removed_line_route` already
   removes bound routes with the same typing gap today, and Phase 1's only
   bound-route producer is an operator applying it to three assistant-bot rooms.
2. **Tool, runtime and game binding.** `murph.leave_group` with accepted-input
   origin (#6) and terminal no-reply (#5); fail-closed group typing (#1,
   runtime half); poll notification chat lock (#4, second half); one game-room
   binding rule (#2). Cloudflare deploys after Web.
