# Murph leaves Linq groups

Status: Phase 1 merged and deployed (#4890); Phase 2 implemented, local verification complete, uncommitted parent handoff
Created: 2026-11-12
Updated: 2026-11-12


## Phase 2 implementation and handoff

- Engine: strict `reason`/`messageRef` tool, authenticated Linq group conversation
  availability, short social-role guidance and terminal interruption while the
  tool RPC is pending. Refusal remains answerable. No classifier was added.
- Hosted execution/runtime/Cloudflare: strict accepted-input request and local
  outcome schemas, unchanged RCS-compatible forwarding with no room injection,
  marker-backed one-replay transport classification.
- Web: callback fence before source decode and again in the mutation transaction;
  persisted input scoped to the callback container, non-self/non-direct exact
  route validation, any-game and active-move refusal, marker-backed replay after
  route deletion, one post-commit provider attempt. Marker stores `assistant`,
  never the tool's explanation or reason. Reason expansion retains old writers.
- Lock order: accepted chat commands take runtime/access then route locks in
  `authorizeGameChatActorTx`, before `commandTransaction` reaches pair/game locks.
  Discovered candidates, app group creation and inbound invite association take
  the container member's `FOR KEY SHARE` lock before the route, then pair,
  audience or game locks. This takes the game's implicit foreign-key lock early,
  avoiding route-to-member inversion with runtime callbacks. Assistant leave
  releases its preflight, then takes chat ownership, owner/container access,
  runtime and route locks; webhook admission already uses chat-before-member.
  Leave only reads game existence; it takes no pair/audience/game lock. Historical rooms
  and fresh route-less bootstrap containers retain their existing rules.
- No production access, actual Linq call, member message, commit, push or PR.
  Commits, exact-head CI and eligible final ReviewGPT remain with the parent.
  Keep this plan active for that completion. Frog list succeeded; no new
  repository friction required a workaround entry.
- Changelog fragment `quiet-group-departure` describes the public behavior.
  Parent must add the Phase 2 PR number to `sourcePullRequests` alongside #4890.

### Phase 2 parent review

- `game-service-postgres` "serializes concurrent room binding and reuses a
  route-less primary across games" failed against the new pair-binding rule,
  because it passed route-less candidates. Production discovery
  (`findExistingGameChat` → `exactChat`) only returns rooms that have a route,
  so the rule stays. The test now gives its candidate rooms routes, then removes
  them before the third game reuses the bound primary.
- Migration renamed to `20261112080000_linq_group_leave_assistant_reason`, so
  its timestamp is not in the future. Changelog copy tightened.

### Phase 2 product walkthrough

Feature: a participant can ask Murph to leave a Linq room silently; the model can
also leave clear bot loops/spam. Unknown humans, banter, AI discussion/pasted
text, quoted requests and quiet requests are counterexamples. Private, email,
Telegram, scheduled, maintenance, recap and output-only turns cannot use it.
All bound game history and active moves refuse without destructive effects.
Seven synthetic live journeys passed on `gpt-6.1-sol`, local subscription with
ambient configuration: bot loop and actual request each called leave once and
stayed silent; banter, quote, quiet request and unknown humans called it zero
times; game refusal called once and gave one truthful explanation. Replies were
reviewed: **Ready** for tested behavior. Local success never claims provider
removal. Deterministic pending-RPC proof covers `left`, `already_left` and an
answerable `unavailable`, including no successful tool response that could start
another model request.

### Phase 2 commands and results

Commands run from the repository root unless a `--dir` is shown. Vitest uses
`--no-coverage`; shell output redaction does not change the command or result.

| Command | Result |
| --- | --- |
| `pnpm exec vitest run --config packages/assistant-engine/vitest.config.ts --no-coverage assistant-leave-group assistant-codex-dynamic-tool-runtime assistant-codex-turn-planning prompt-route-matrix` | 234 passed. |
| `pnpm exec vitest run --config packages/hosted-execution/vitest.config.ts --no-coverage group-tool-dispatch-parser` | 58 passed. |
| `pnpm exec vitest run --config packages/assistant-runtime/vitest.config.ts --no-coverage hosted-runtime-group-tool-linq-context hosted-runtime-linq-outbox-regression` | 67 passed. |
| `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts --no-coverage group-tool-port-replay` | 20 passed. |
| `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage game-chat-tool game-chat-membership game-chat-bootstrap game-chat-delivery game-chat-lifecycle hosted-group-tool.test production-migration-guard hosted-linq-group-leave-tool hosted-group-tool-route` | 515 passed; three existing opt-in bootstrap/skew cases skipped. |
| `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage game-chat-tool game-chat-membership game-chat-bootstrap game-chat-delivery game-chat-lifecycle` | Final binding-lock recheck: 208 passed; three existing opt-in cases skipped. |
| `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage hosted-linq-group-leave-tool hosted-group-tool-route` | 52 passed, including the held-chat regression that prevents member/runtime locks before chat ownership. |
| `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage game-chat-membership game-chat-delivery changelog-page changelog-fragments` | 79 passed; one existing opt-in case skipped. Changelog generation also passed in Web typecheck. |
| `MURPH_MEASURE_GAME_INPUT=1 MURPH_VERIFY_GAME_SKEW=1 MURPH_GAME_INPUT_BASE=HEAD pnpm exec vitest run --config packages/assistant-engine/vitest.config.ts --no-coverage assistant-game-input-measurement -t 'complete.*\((direct\|group)\)'` | Two passed; unrelated mixed fixture skipped. Direct complete provider input unchanged at 123,509 bytes. Group grows 157,210 to 159,133 bytes (+1,923, 1.22%); registered tool schema adds 727 bytes. Exact token counts unavailable because no exact model tokenizer is configured. |
| `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/murph_test_linq_group_leave_phase2 MURPH_TEST_POSTGRES_CONCURRENCY=1 MURPH_VITEST_FILE_PARALLELISM=0 MURPH_VITEST_SUITE_CONCURRENCY=0 pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage --silent=true hosted-linq-group-leave-postgres` | 22 passed, including both route-lock race orders, any-status refusal and marker reason. |
| `MURPH_PRISMA_SKIP_ENV_FILES=1 DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/murph_test_linq_group_leave_phase2 pnpm --dir apps/web prisma:migrate:deploy` | All 287 migrations and schema contract passed on a fresh isolated local database. |
| `pnpm --dir apps/web prisma:generate` | Passed. |
| `pnpm --dir packages/hosted-execution typecheck`; `pnpm --dir packages/assistant-engine typecheck`; `pnpm --dir packages/assistant-runtime typecheck`; `pnpm --dir apps/cloudflare typecheck`; `pnpm --dir apps/web typecheck:prepared` | Passed. |
| `pnpm --dir apps/web lint` | Passed with existing warnings. |
| `pnpm complexity:diff`; `pnpm docs:drift`; `git diff --check` | Passed. Complexity adds no debt across 19 source files. |

Live command requested by the brief, `pnpm test:assistant:live -- --test "linq group leave"`,
was rejected before provider entry because the skill runner permits exactly one
journey. Ran the same supported command once each with these exact patterns:
`linq group leave: bot loop`, `linq group leave: human banter`,
`linq group leave: actual request`, `linq group leave: quoted request`,
`linq group leave: quiet request`, `linq group leave: unknown humans`,
`linq group leave: game refusal`. All seven passed without auth-mode switching.

Initial Web typecheck failed because generated Prisma bindings were absent;
`prisma:generate` resolved it. The first migration attempt identified the
required predeploy reason-expansion allowance; its focused guard test passes.
The older Phase 1 test database had the marker table with inconsistent migration
history (`P3018`, relation exists), so no reset/repair was attempted: a new local
Phase 2 database was created. Initial game mocks lacked the new route lock and
were corrected; a race fixture lacked required `joinedAt` and was corrected.
The maintenance availability fixture needed its required profile and was corrected.
These setup failures are not claimed as product failures or passing checks.

### Phase 2 skew and deploy order

**Migration/Web first, then Cloudflare/runtime.** Old runner/new Web continues
using existing egress errors and existing request shapes. Unchanged consumer
proof passed: `pnpm exec vitest run --config packages/assistant-runtime/vitest.config.ts --no-coverage hosted-runtime-callbacks hosted-runtime-system-mailbox-notification -t "blocks routed Linq provider egress when route authority is revoked|terminally advances a stale frozen referral target"`
(two passed; unrelated cases skipped). It proves zero Linq provider entry after
route rejection and durable terminal notification settlement with the next
mailbox item advancing. Parser regression coverage preserves old actions.
`pnpm exec vitest run --config packages/assistant-engine/vitest.config.ts --no-coverage assistant-outbox-runtime -t 'replays a tracked'`
also passed four cases, including definite pre-provider route loss settling a
tracked receipt after restart without provider reentry. An initial narrower
filter matched no cases; only the corrected four-case run counts as proof.
No live deployment or provider-removal outcome was tested. Retain the Phase 1
Web rollback floor and refresh runtime producers only after Web accepts the new
action; an older runner simply has no leave tool.

## Phase 1 implementation notes

- Web owns the marker, purpose-separated encrypted identity, atomic departure,
  route-writer and webhook fences, source-group recovery fences, oversized
  auto-leave, and the full-ref Ops action. Provider dispatch remains one
  request-local post-commit attempt.
- The current contact-privacy owner explicitly removed its old rotation runner.
  Phase 1 supplies `rotateHostedLinqGroupLeaveBatch` and documents it in the
  existing rotation contract; it does not resurrect a general migration service.
- No package, runtime, game-binding, or poll-notification admission change is
  included. Those accepted findings retain their Phase 2 ownership.
- No public changelog: this phase adds internal departure control and provider
  cleanup; the oversized room's already-silent member experience is unchanged.
- Commit, push, PR, CI and final ReviewGPT remain with the parent session.

## Phase 1 local verification

Final departure provider-boundary proofs used synthetic mocks. No production
access, message, commit, push or PR was performed. The isolated loopback test
database is `murph_test_linq_group_leave`.

The final focused command passed **1,093 tests**, with three existing opt-in
game bootstrap/skew cases skipped (23 files passed, one skipped):

```sh
pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage --passWithNoTests --silent=true \
  hosted-linq-group-leave-webhook hosted-linq-group-line-move.test \
  hosted-onboarding-linq-dispatch hosted-onboarding-linq-home-route-recovery-service \
  hosted-onboarding-linq-mailbox-root-prewarm.test \
  hosted-onboarding-linq-message-edit-preparation-composition \
  hosted-onboarding-linq-read-receipt-authority hosted-onboarding-linq-route.test \
  hosted-onboarding-linq-thread-route hosted-onboarding-linq-transport \
  hosted-onboarding-linq-usage-reset-e2e hosted-onboarding-linq-webhook.test \
  hosted-onboarding-linq-egress-engagement hosted-visible-secondary- \
  hosted-thread-delivery-route-repair hosted-ops-linq-group-line-move-route \
  hosted-onboarding-webhook-idempotency hosted-prepared-thread-container \
  production-migration-guard game-chat-bootstrap game-chat-delivery
```

The PostgreSQL command passed **146 tests in three files**. The new departure
suite also passed all **13 tests** after tightening test cleanup to its own
markers. This uses the same config and serial settings as the repository's
automatically discovered PostgreSQL lane:

```sh
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/murph_test_linq_group_leave \
MURPH_TEST_POSTGRES_CONCURRENCY=1 MURPH_VITEST_FILE_PARALLELISM=0 MURPH_VITEST_SUITE_CONCURRENCY=0 \
pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage --silent=true \
  hosted-linq-group-leave-postgres hosted-linq-group-line-move-postgres \
  hosted-linq-group-line-move-producer-postgres
```

Other completed checks:

| Command | Result |
| --- | --- |
| `pnpm --dir apps/web prisma:generate` | Passed. |
| `MURPH_PRISMA_SKIP_ENV_FILES=1 DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/murph_test_linq_group_leave pnpm --dir apps/web prisma:migrate:deploy` | Passed all migrations and the hosted schema contract on a fresh local database. |
| `MURPH_PRISMA_SKIP_ENV_FILES=1 DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/murph_test_linq_group_leave pnpm --dir apps/web prisma:validate` | Passed. |
| `node --test scripts/check-pr-migration-history.test.mjs` | Eight tests passed. A separate working-tree byte comparison confirmed all 286 existing migration-directory files match `origin/main`; only the new additive migration was added. The exact-commit PR guard remains with the parent. |
| `pnpm --dir apps/web typecheck:prepared` | Passed. |
| `pnpm --dir apps/web lint` | Passed with existing warnings. |
| `pnpm complexity:diff` | Passed at threshold 20; no added complexity debt across 12 changed source files. |
| `pnpm docs:drift` | Passed. |
| `git diff --check` | Passed; authored additions also passed the identifier and Phase 1 scope scan. |

An earlier broader Web run passed 2,068 cases and exposed four test failures:
two assertions on a nonexistent fixture spy and two composition fixtures missing
the new marker delegate. These were fixed; all 183 cases in those two suites
then passed, followed by the green focused command above. No product fallback
was added to accommodate incomplete mocks. Phase 2-only runtime/game/poll-lock
and real-Codex journeys were not run. Exact-head CI and ReviewGPT require the
parent's committed candidate and remain outside this uncommitted handoff.

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
| Refuse assistant leave when any game is bound, in any status, or during an active line move. Ops keeps the Phase 1 active-only game guard. | Game history establishes real players; the room is not AI slop. This replaces review finding 2 and preserves historical rematch/bootstrap reuse. |
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
The marker reason for tool calls is `assistant`; the tool reason is logged only as a bounded code. Auto/Ops reasons stay `oversized` and `operator_cleanup`.

Expose only in authenticated Linq group-container conversation turns with
accepted input; exclude private, email, Telegram, scheduled, recap, maintenance
and output-only turns. Resolve `messageRef` against current accepted inputs; forward only its accepted-input
origin and the bounded reason, without leave-specific room context. Web
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
or spam, or a room with no real people; honor a current participant's actual leave request.
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
| `packages/hosted-execution/src/runtime-control.ts`, `parsers/runtime-control.ts`; `packages/assistant-runtime/src/hosted-runtime/group-tool-context.ts` | Strict request/response variants; forward accepted-input origin without room-context injection. |
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
- Engine `assistant-leave-group.test.ts`, `assistant-codex-dynamic-tool-runtime.test.ts`,
  `assistant-codex-turn-planning.test.ts` and `prompt-route-matrix.test.ts`, then synthetic `assistant-codex-real-e2e.test.ts`
  journeys: bot loop, human banter, unrecognized humans, actual leave request,
  quoted injection, quiet request and live game. Assert exact tool args/count,
  silence on success and no announcement/private DM.

Implementation checks: focused Vitest through owning configs (Web uses
`apps/web/vitest.workspace.ts`), migrated local Postgres proof, relevant
typechecks/lint, then `pnpm test:assistant:live -- --test "linq group leave"`
under the assistant-verification skill, with Ready/Hold reply review. Exact-head
CI and one eligible final ReviewGPT round follow local proof in the parent
completion session. Phase 2 local evidence is recorded above.

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
health needs real provider facts) and the existing group-tool transport. The initial review accepted all seven findings. The Phase 2 owner decision
below supersedes finding 2 and permits deferral of the runtime halves of 1 and 4:

| # | Finding | Disposition |
| --- | --- | --- |
| 1 | Group typing (`channel-activity.ts` `prepareHostedLinqTyping`) starts without route authority; Web unbound-notice dispatch and private recovery are permissive by design. | Web half shipped in Phase 1. Defer runtime typing by the Phase 2 owner exception: `prepareHostedLinqTyping` delegates group start and refresh to the shared channel activity session; fencing both adds per-refresh Web authority calls and changes session failure/cleanup semantics. Early webhook rejection stops new turns; an already-running typing session can still show a bubble. Bound output remains denied by existing route authority. No typing lock order changes. |
| 2 | Game-room reuse (`readPairGameChatTx`, `bindPairGameChat`, rematch, bootstrap) treats a route-less historical room as usable, so a left room can be inherited and re-bootstrapped. | Replaced by explicit Phase 2 owner decision: assistant leave refuses any bound game, including settled or void history, because that room has real players. Keep historical rematch/bootstrap binding rules unchanged and Ops active-only. First-time provider-room bindings still serialize their existing route validation with leave using the route row lock; leave reads game existence after that lock. |
| 3 | A blind-index-only marker is lost once its key leaves the two-key read set. | Accept. Add one purpose-separated encrypted chat-id field (contact-phone-envelope pattern) so rotation can re-derive and reseal. Decide before the first marker write. |
| 4 | Poll-vote notifications append to the mailbox outside the chat lock. | Early marker check shipped. Defer notification-admission lock by the Phase 2 owner exception: `maybeNotifyPollResult` prepares destination/completion outside its transaction, then takes active-access locks, validates the route, claims the poll and appends. Adding chat ownership changes that cross-owner lock order while still not canceling already-admitted work. Exposure is one poll notification already in flight; existing route-authority egress denies output and system-mailbox terminal settlement advances it durably. No poll lock changes. |
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
   origin (#6) and terminal no-reply (#5); any-game refusal replacing #2;
   route locking at first game-binding boundaries. Typing and poll admission
   are deferred as recorded above. Cloudflare deploys after Web.
