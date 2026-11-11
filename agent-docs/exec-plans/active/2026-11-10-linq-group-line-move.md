# Move a group chat to another Murph line

Status: active
Created: 2026-11-10
Updated: 2026-11-11

## Historical delivery settlement follow-up

Outcome: existing groups can move past historical delivery metadata while every
unsettled outbox obligation retains its original route and retry opportunity.
Reaches: confirmed legacy sends, idle runtimes with deferred retries, and empty
outboxes whose old Web dispatch fences have no terminal receipt.
Proof: real PostgreSQL producer/consumer cases plus canonical outbox and snapshot
publication tests; keep missing, stale, incomplete and active evidence fail-closed.

Review of candidate 06521196bafab6c80a9a853b5e8f0347fa1fd426 found one accepted
High: an empty Web dispatch fence can still represent a checkpointed runtime
outbox retry. Its timestamp does not advance on replay, and mailbox acknowledgement
plus runtime idleness does not prove settlement. The 15-minute age-only exemption
is removed. The regression reproduces the unsafe move through the production
fence writer after a 31-minute idle interval, then proves rejection until the
normal delivery outcome writer settles it. Confirmed historical sends retain
the narrow age/source/payload exemption.

For unresolved historical fences, derive a snapshot-bound settlement witness from
the existing complete outbox inventory in generated-delivery cleanup. It is true
only for a trusted scan with no active or confirmation-pending intent. Snapshot
completion writes the current snapshot ID or null in the existing checkpoint
status; it never carries a prior witness into a replacement snapshot. No new
scan, table, queue, provider call or model decision is needed. Old writers omit
the witness or retain a mismatched old ID and cannot authorize the exception.

Operator start locks runtime ownership, requires idle, and checks the witness
against the current validated member-bound snapshot. Only empty historical
runtime dispatch fences older than that snapshot and the conservative drain can
then cease to veto. Saved payloads, recent fences, partial outcomes and unknown
sources still block. The ledger itself is never rewritten. One bounded workspace
metadata read is added only to operator start; snapshot inventory work is reused.

The current runtime and Web readers/writers must converge before the canary, then
a fresh idle snapshot supplies the proof. Reverting either side loses the
exception safely. This settlement extension changes a protocol/authority boundary
after round 1 and therefore requires a fresh full final review on the stable head.
The active plan stays open through the provider canary and duplicate repair.

Focused settlement proof passes: 116 Web producer, consumer and route tests;
43 engine residue tests; and all 158 snapshot bridge tests. The real-writer retry
regression first reproduced the unsafe reservation on the age-only candidate.
The corrected cases preserve its veto, then allow canonical acceptance or a
current trusted snapshot to settle historical evidence. Web lint passes with
existing warnings; workspace typecheck and documentation drift pass, and
complexity debt is unchanged. The new full review, exact-head CI and deployment
remain gates.

## Legacy route projection follow-up

Outcome: an authorized silent move can start for a legacy route whose nullable
account projection has not been backfilled. The sealed delivery route remains
the authority; no provider effect may precede its validation and reservation.
Reaches: operator starts for existing Linq groups, including a null projection,
an inconsistent non-null projection, and a route changed during preparation.
Proof: real Postgres producer/consumer tests with a fake provider must preserve
the same container through adoption and leave, reject mismatched or changed
authority without an add, and leave the projection untouched on failed starts.

The observed blocker is a null `hosted_thread_route.account_lookup_key` on an
otherwise existing sealed route. The start guard currently rejects that row
before opening its authoritative route. Derive the source key from the validated
sealed route, retain both identity/key consistency checks, and fill only a null
projection inside the existing source-locked reservation transaction after all
quietness and line checks pass. Revalidate the exact originally read row and use
a conditional update; a mismatch remains a conflict. No bulk backfill, new
endpoint, credential path, schema, or ingress work is needed. Rollback leaves a
valid projection understood by the previous producer.

The candidate overview remains an indexed view of projected routes. An operator
can use an exact opaque route reference obtained through authorized control
diagnostics to start a legacy route. No plaintext identity is accepted.
The requested real-group test is authorized, but waits for this fix's focused
proof, review, exact-head CI and managed deployment. No group move has started.

An additional preflight exposed a second start blocker: system acknowledgements
advance the canonical lane watermark without stamping every item's `consumed_at`.
The quietness guard mistook already handled system items for pending work.
Use the existing one-statement `readHostedMailboxProgress` projection, including
its live-item retention and expiry rules, and compare lane high-water marks to
consumed watermarks. Keep the recent-conversation, active-runtime and pending
delivery guards. This adds one bounded metadata read only to operator start;
it neither changes acknowledgements nor replays or discards mailbox items.
New synthetic cases reproduce the acknowledged/expired-item rejection before
the correction and preserve rejection for unacknowledged system work and recent
acknowledged conversation. The fixture now settles work through canonical lane
acknowledgement rather than timestamp-only updates.

Round 1 passed on `c220df0b440a88fc63982f9ff1fc3e3a3d703aed`. The mailbox guard
correction adds production behavior after that review, so the completion owner
will run round 2 on the next stable pushed head alongside fresh exact-head CI.

Local verification reproduces both start blockers before their corrections
and passes afterward: 78 consumer/producer PostgreSQL tests plus 15 move-unit
and Ops-route tests. Coverage includes the complete legacy start/hold/adopt/leave
path, unchanged projected starts, inconsistent authority, a projection changed
during provider preparation, concurrent starts and failed quietness checks.
Root typecheck, Web lint, complexity, docs drift, whitespace and privacy checks pass.
No prompt, assistant tool or model decision changes, so real-model testing is
not the changed behavior's proof boundary. Full CI and the external review run
on the stable pushed candidate; real-provider confirmation remains outstanding.

## Parent continuation and release checkpoint

The resumed parent owns PR #4806 completion, including the push, required
review, CI and merge. The local-only instructions in the worker checkpoint
below describe that delegated slice, not the parent release scope.

The silent design keeps the original group identity and sends no announcement.
A source message that reaches the 60-second fallback disarms that reservation;
verified cancellation and a fresh reservation are the supported recovery.
Later adoption within the expired reservation is deliberately excluded because
cross-line message IDs do not provide a proven deduplication identity. The
operator must move only one group at a time and avoid a second unbound room
with the same human roster and both service numbers during that reservation.

Parent candidate review inspected the full producer and ingress changes, both
accepted cancellation findings, the scoped migration and the production-path
regressions. The round-1 remediation result is 180 focused tests plus 872 Web files and
14,609 Web tests passing; root typecheck, lint, complexity, docs drift and diff
checks pass. No assistant prompt or model decision surface changes, so model
behavior is not the evidence boundary; the composed webhook/Postgres tests
exercise admission, identity, cancellation and handoff with a fake provider.

A bounded production read confirmed zero move rows and only the consumer
migration applied before release. No real group operation was performed.
Local correctness is Ready; execution against real groups remains Hold pending
Web convergence and explicit authorization of the throwaway-group proof. The
active plan remains open for that provider proof and the separate duplicate
repair. Publication of the operator code does not start a move.

Round 2 reviewed the stable pushed candidate alongside CI because the fixes
added persisted removal receipts and a migration extension. Its sole finding
and the focused correction are recorded at the end of this plan.

## Historical worker checkpoint: PR 4806 round 1 remediation

Both High findings in `audit-packages/pr-4806-round-1.md` are accepted.
This continuation is local only: no push, PR edit, production access, real
Linq API, dotenv reads or further ReviewGPT. Keep the plan active and commit
with `scripts/committer`.

Outcome: cancellation cannot fork group identity or remove a later destination.
Reaches: delayed target webhooks, cancel/restart, overlapping operator cancels.
Proof: extend the real webhook/Postgres source-fallback scenario through both
replay timings and a fresh handoff; pause cancellation across cleanup ownership
and restart, retaining queued-removal and interruption recovery coverage.

The existing move row owns both corrections. Ingress retains a bounded view
of recent cancellations and checks event creation against the add claim.
Removal receives one durable claim and a provider-return receipt; an uncertain
or still-dispatchable claim keeps the reservation unavailable. No new queue,
table, retry system or provider mutation path is introduced. Extend only the
unmerged silent-producer migration. Verification and final dispositions follow
below after execution.

## Goal

Murph runs on two Linq lines and is retiring one to halve the provider bill.
New members have only been placed on the kept line since the assignment-weight
drain (`docs/hosted-linq-db-home-lines-migration.md`, "Draining automatic
assignments"). What remains on the retiring line is a few dozen 1:1 members and
a few dozen iMessage group chats, a handful of them active, two with a live
game.

1:1 members move with the existing `POST /api/ops/linq-rehome` primitive and the
existing `conversation_home_redirect` reply. That needs no new design.

Group chats have no equivalent. This plan adds one founder-gated operation:
**move one existing group chat from one Murph line to another, keeping the
group's identity** (its `HostedThreadContainer`, `HostedGroup`, members,
disclosure grants, runner workspace, journal, memory, and game link). The owner
also wants it as standing infrastructure: the same operation is the recovery
path when a line is flagged.

## What is known (evidence)

- Linq has no "transfer a chat to another number". Its own failover opens a new
  chat from another line. Linq does expose `chats.participants.add` (iMessage
  groups, 3+ participants) and `chats.leaveChat` (iMessage groups with 4+ active
  participants including the leaver). Neither is called anywhere in this repo.
- A group's identity is the container member id. The only link from a Linq chat
  to the group is one `hosted_thread_route` row keyed
  `(channel, thread_identity_lookup_key)`. `thread_identity_lookup_key` blinds
  the chat id; `thread_lookup_key` blinds line plus chat id;
  `delivery_route_encrypted` is sealed to the container member
  (`thread-delivery-route.ts`). Notifications require exactly one route per
  container (`assistant-notification-destination.ts`).
- Live production test, 2026-11-10: a person added the kept line to a group
  already served by the retiring line.
  - The kept line received no event at add time. Its first event was the next
    `message.received`, in a chat with a different lookup key and different
    message ids.
  - With no route for that chat, the unbound-group path
    (`planHostedLinqGroupChatWebhook` → `ensureHostedPreparedLinqThreadContainerRouteTx`)
    created a second, empty container and group owned by the sender, and replied.
  - Each line received the other line's replies as ordinary inbound messages
    (`isFromMe` false).
- Scheduled group sends store the chat id as their target. Web resolves that
  target through `readHostedThreadRouteByThreadIdentity`
  (`linq-egress-engagement.ts`); a missing route falls into the direct-member
  path and fails with a route-authority mismatch. The runner accepts a changed
  target only with a conversation locator (`cron/execution.ts`), and home-route
  fallback is allowed only for direct threads.
- The runner's conversation thread id hashes the chat id
  (`mailbox-conversation-import.ts`), so a new chat id is a new assistant
  session. Workspace files (memory, journal, room model) are keyed to the
  container and survive.
- Not verified: whether Linq lets one partner line add a sibling partner line
  through the API. The first real run is the proof, and it fails closed.

## Design (first draft, superseded by "Revised design" below)

One move = one row in a new table, driven by one ops endpoint and one webhook
branch. Moves are serial per target line.

### State

New table `hosted_linq_group_line_move`:

- `id`, `container_member_id` (FK), `from_account_lookup_key`,
  `to_account_lookup_key`
- `from_thread_identity_lookup_key` (the retired chat; unique)
- `to_thread_identity_lookup_key` (null until adopted; unique when set)
- `status`: `requested` → `added` → `announced` → `adopted` → `left`, or
  `failed` / `cancelled`
- `expires_at` (short TTL for the pre-adoption states), timestamps,
  `failure_code`
- Partial unique index: at most one row per `to_account_lookup_key` in a
  pre-adoption state.

The row has two lasting jobs after the move: it is the tombstone that stops the
retired chat from being re-admitted as a new group, and it is the alias that
lets stored scheduled targets resolve to the group's current route.

### Operation

`POST /api/ops/linq-group-line-move` (same guard as `ops/linq-rehome`:
`requireHostedOpsRequestAccess`, same-origin mutation). Body:
`{ containerMemberId, targetLineLookupKey }`. `GET` lists rows by status with
hints only.

1. **Validate and reserve** (one short transaction). The container has exactly
   one Linq route and it is on a different line; chat health says iMessage
   group; the target is in `listHostedLinqAssignableHomeLines`; no pre-adoption
   move exists for the target line. Insert the row as `requested`.
2. **Add** (outside the transaction). From the current line, call
   `chats.participants.add(oldChatId, targetLineNumber)`. On provider refusal,
   mark `failed` and stop; nothing else has changed. On success, mark `added`.
3. **Announce.** Send one fixed notice into the old chat from the current line
   through the existing delivery path (new template `group_line_move`, with the
   usual variant bank). This is what makes the chat exist on the target line.
   Mark `announced`.
4. **Adopt** (webhook, target line). In the unbound-group branch, before any
   container creation: if the sender handle is the `from` line of the single
   `announced` move for this receiving line, then
   - read the new chat's roster from Linq and require it to equal the old
     container's observed roster plus both lines; otherwise mark `failed` and
     ignore the message;
   - in one transaction: seal a delivery route for the new chat and line to the
     existing container, delete the old route row, insert the new one, set
     `to_thread_identity_lookup_key`, mark `adopted`;
   - consume the notice. It is not forwarded to the runner.
5. **Leave.** After commit, call `chats.leaveChat(oldChatId)` on the old line.
   Mark `left`. A refused leave is recorded and retried by the operator; the
   tombstone already makes the old chat inert.

### Two standing rules the row enforces

- **Tombstone.** A group message on a chat whose thread identity equals an
  adopted move's `from_thread_identity_lookup_key` is ignored. Without this, a
  failed leave would let the old line admit the same chat as a new group.
- **Alias for stored targets.** When a scheduled Linq send from a container
  targets a thread identity with no route, and that identity is the
  `from_thread_identity_lookup_key` of an adopted move for the same container,
  resolve to the container's current route and return its chat id with a
  conversation locator. Everything else keeps failing closed.

### Adopting an already-created container

The 2026-11-10 test left one chat with a second, empty container on the kept
line. The endpoint accepts an optional `replaceContainerMemberId` for that case:
the adopt transaction requires that container to have the same owner, no game,
and no members beyond the owner, then deletes its route and marks it for the
existing container-deletion path before inserting the new route.

## Non-goals

- No bulk or automatic moves, no health-triggered failover, no ops UI.
- No change to 1:1 rehome, the home redirect, or line assignment.
- SMS and RCS groups are not movable (Linq participant management is iMessage
  only). The endpoint rejects them.
- No attempt to carry the assistant session across; memory files carry over.

## Failure modes

| Failure | Result |
| --- | --- |
| Linq refuses the sibling add | `failed` at step 2; group untouched |
| Notice sent, target line never sees the chat | Row expires; old route still live; operator retries or cancels |
| A person speaks before the notice lands on the target line | Sender is not the `from` line, so adoption does not trigger; the unbound-group path would create a new group. Mitigation: while a move for that target line is `added` or `announced`, hold unbound-group admission on that line for chats whose roster contains the `from` line, until expiry |
| Roster mismatch at adoption | `failed`; no route change |
| Adopt commits, leave refused | Tombstone keeps the old chat inert; leave retried |
| Both lines briefly present | Old line stops replying at `announced` (route still owned, replies suppressed for chats with a pre-adoption move) |
| Wrong chat adopted | Would send a group's private context to other people. Guarded by sender = `from` line, single pre-adoption move per target line, roster equality, TTL |

## Deploy and skew

- One additive migration (new table). No change to existing columns.
- The webhook branch and the egress alias are inert without rows. Deploy Web
  first; no runner or Cloudflare change is expected. If the conversation
  locator for a group alias needs a runner change, that is called out in review
  and split.
- Rollback before any move: revert freely. After a move: the adopted route is an
  ordinary route row and keeps working on older code; only the tombstone and the
  stored-target alias are lost, so do not roll back past this change while a
  moved group still has scheduled sends targeting its old chat.

## Product UX plan

- **Outcome:** people in the group see "Murph added [number]", one short line
  from Murph saying it is switching numbers, then "Murph left". Murph keeps the
  group's memory, game, and schedule.
- **Affected people:** group members who saved the old number as Murph (the new
  number shows as unknown until Murph's contact card is shared, which the first
  reply already prompts); the group owner; players in a live game.
- **Proof:** one throwaway group moved end to end in production, then one group
  with a live game, each checked for a single route, a reply from the new line,
  a game notice from the new line, and one scheduled send.

## Open questions for review

1. Is there a simpler correlation than "first message from the `from` line while
   one move is pending per target line"?
2. Is the tombstone-plus-alias row the right owner for stored scheduled targets,
   or should the move rewrite targets in the runner workspace instead?
3. Can step 3's reply suppression and the admission hold be dropped by ordering
   (for example, leave before announce is impossible because the old line must
   speak last)?
4. Is anything here deletable: the roster check, `replaceContainerMemberId`, the
   TTL?

## Tasks

1. ReviewGPT on this plan; record each finding as accepted or rejected here.
2. Migration, store, ops endpoint, Linq client calls for add and leave.
3. Webhook adopt branch, tombstone, admission hold.
4. Egress alias for stored scheduled targets.
5. Focused tests, including a Postgres test for the adopt transaction.
6. Production proof on a throwaway group, with explicit owner go-ahead.

## Review outcome

ReviewGPT architecture review, 2026-11-10, verdict "revise before
implementation". The core model stands: the container stays the group's
identity, has exactly one active route, and the move row keeps retired-route
history with a Web-owned alias. Every finding below is accepted; findings 4, 5
and the flagged-line note in 1 were spot-checked against the code
(`chat-membership.ts` `isExactGameChat`, `chat-delivery.ts`
`readGameProposalDeliveryPlayers` ordering in the engagement route,
`linq-egress-policy.ts` `line_flagged`).

| # | Finding | Outcome |
| --- | --- | --- |
| 1 | "First message from the old line" plus roster equality cannot tell two rooms with the same people apart, and a flagged source line cannot speak at all | Accepted. The base operation becomes "replace this container's exact current route with this exact, freshly verified destination chat". The healthy-source path correlates with a per-move marker persisted before the notice is sent. Unrelated messages never fail a move |
| 2 | Phase updates and TTL do not settle provider effects; webhooks can beat the database update; the old chat id is lost once the route is deleted | Accepted. Admission protection and the marker are armed in the reservation, before the add. Receipt of the marked notice is the proof of delivery. The row is resumable, keeps encrypted source cleanup coordinates, and adoption is permanent. Holds use the existing retryable-error pattern (`assertNoPendingGameChatBootstrapTx`), not an acknowledged ignore |
| 3 | `HostedThreadContainerParticipant` is not a complete roster | Accepted. Compare complete `getHostedLinqChatSummary` reads of both chats, allowing for the two service numbers. An incomplete read is inconclusive and retryable |
| 4 | Game audience checks require exactly one self handle and exact people, so games break while both lines are present or if the leave is refused | Accepted. Either normalize the audience for the move's two verified service numbers, or pause game work until the leave is confirmed. Decide before any live-game group is moved |
| 5 | The alias does not cover game notices already queued for the old chat, because game validation runs before route resolution | Accepted. Resolve the same-container move relation in Web egress preparation before game validation. Keep alias-following out of `readHostedThreadRouteByThreadIdentity` |
| 6 | Human messages arrive on both lines with different ids; a delayed old-line reply can land on the new chat as user input | Accepted. Consume messages from the move's verified source number on the destination chat, including after adoption. Handoff policy for people: while a move is pre-adoption, hold inbound for that chat on both lines with a retryable error; after adoption the old-line copy meets the tombstone and the new-line copy is accepted once. The first proof must exercise traffic during the handoff |
| 7 | Rollback floor is independent of schedules; older Web ignores holds and tombstones | Accepted. Move-aware ingress is a rollback floor from the first reservation onward |
| 8 | Route replacement belongs in `thread-container-service.ts` | Accepted. One "replace expected route" primitive there; ops and webhook compose it |
| 9 | `replaceContainerMemberId` misses its branch and deletes on weak emptiness checks | Accepted. Removed from the mover. The one duplicate left by the 2026-11-10 test is a separate, explicit founder repair |

Consequences for scope:

- The work is no longer one endpoint and one webhook branch. It touches group
  ingress, Web egress preparation, game audience and notice validation, the
  route owner, and the release gate.
- Linq rejects group actions on a line that cannot send, so the scripted add
  cannot help when the source line is flagged. That case needs a person to add
  the new number and then the exact-destination replacement.
- Once the retiring line is cancelled Murph has one line, and this operation has
  no second line to move a group to until another is provisioned.

Owner decision, 2026-11-10: build the full move.

## Revised design

The silent-move owner decision below supersedes the notice-specific parts of
this section and the historical PR A checkpoint. Other invariants still apply.

## Owner decision: silent move

2026-11-10: Murph posts no announcement, notice, template or marker. The source
number adds the target number; after adoption the source number leaves. This
replaces the marker correlation accepted in review finding 1: one reserved move
per target line plus fresh, complete source/candidate rosters with equal people
and both verified service numbers active in the candidate authorize adoption
on the first inbound message of any kind. Source-service speech is consumed;
a person's event must survive adoption and enter the normal group reply path.

PR B keeps the single route writer, existing chat locks, after-response leave
and provider retry owner. Cleanup encryption and provider calls stay outside
transactions. Start sets a 24-hour adoption deadline; expiry preserves source
authority, resume reports expiry, and cancel verifies target removal. The
legacy notice hash becomes nullable through a forward migration and is omitted
from new reads/writes; the column stays for old Web readers during rollout.

The source hold is 60 seconds from the original webhook creation time,
using the same retryable 503 boundary as game bootstrap. Linq documents stable
event creation time across retries, exponential backoff with jitter and a
30-minute retry window. The bound releases on the first retry after 60 seconds,
well within that window; it is not a new timer or retry system.
Source: https://docs.linqapp.com/channel/imessage/guides/webhooks/.

Conservative checkpoint deviation: on the first source message beyond that
bound, the source transaction expires automatic adoption before admitting the
message normally. The row remains reserved for cancel; resume never renews it.
Expiry also restores ordinary source admission. This avoids both indefinite
source downtime and unproved cross-line deduplication, but **does not implement
later adoption within the same reservation after a source fallback**. That
requested path remains blocked pending a reliable shared message identity.
The user was asked whether original `sent_at` is guaranteed equal on both
copies; no such guarantee appears in the SDK or public webhook contract.

Open implementation questions: cross-line message ids differ and the provider
does not document a shared message identity; exact cross-copy deduplication
needs an authority stronger than text matching. Roster equality also cannot
distinguish two unbound chats with identical people and both service numbers.
These limits must be resolved conservatively and recorded with the proof.

Work is local to the producer checkout. No push, PR, production access, real
Linq API, dotenv reads or ReviewGPT is authorized. Keep this plan active.

### Historical revised design

### Base operation

**Replace this container's exact current route with this exact, freshly verified
destination chat.** One new primitive in
`apps/web/src/lib/hosted-routing/thread-container-service.ts` does it. It takes
prepared destination route material (sealed to the retained container outside
the transaction), the expected current route, and the move row. Under the
existing chat locks, in one short transaction, it rereads and compares the
expected source route, deletes it, inserts the destination route, clears pending
reaction context, and marks the move adopted. Ordinary route refresh stays
unable to change ownership or line.

### Move row

`hosted_linq_group_line_move`:

- `id`, `container_member_id`, `from_account_lookup_key`,
  `to_account_lookup_key`
- `from_thread_identity_lookup_key`, `to_thread_identity_lookup_key` (null until
  adopted)
- `source_cleanup_encrypted`: the old chat id and both service numbers, sealed
  to the container, so leave and cancel can be retried after the old route row
  is gone
- `notice_text_hash`: hash of the exact notice text, which carries a short
  random reference; persisted in the reservation, before any provider call
- `status`: `reserved` → `adopted` → `left`, or `cancelled`. Adoption is
  permanent. A refused leave never moves a row backwards
- `adoption_deadline_at`: after it passes, the marked notice no longer
  authorizes adoption. Protection stays until adoption or a verified cancel
- diagnostic progress only, never authority: `add_started_at`,
  `add_confirmed_at`, `notice_sent_at`, `adopted_at`, `leave_confirmed_at`,
  `last_error_code`
- at most one `reserved` row per target line and per source thread identity
  (partial unique indexes). Retries resume the same row
- all lookup-key matches use the existing read-candidate helpers so a privacy
  key rotation does not strand a row

### Ingress rules for group messages

Evaluated in the Linq webhook planner. "Hold" means the existing retryable
error pattern (`assertNoPendingGameChatBootstrapTx`), so the provider redelivers;
it is never an acknowledged ignore.

Chat has a route:

1. The chat is the source of a `reserved` move: hold messages from people.
2. The chat is the destination of an adopted move and the sender is that move's
   verified source service number: consume. This covers delayed old-line
   replies after adoption.
3. Otherwise unchanged.

Chat has no route:

1. The receiving line is the target of a `reserved` move, the sender is that
   move's source service number, the text hash equals `notice_text_hash`, and
   the deadline has not passed: attempt adoption. Read both chats with
   `getHostedLinqChatSummary`; require both reads complete and the active handle
   sets equal once both service numbers are set aside. Then run the base
   operation and consume the message. An incomplete or failed read is
   inconclusive and retryable. A roster mismatch records `last_error_code` and
   holds; it does not cancel the move.
2. The receiving line is the target of any `reserved` move and the chat's
   provider roster contains that move's source service number: hold.
3. The chat's thread identity is the source identity of an adopted move:
   ignore. This is the tombstone.
4. Otherwise unchanged.

After adoption the old-line copy of a person's message meets the tombstone and
the new-line copy is accepted once. Before adoption both copies are held.

### Egress

In Web egress preparation, before target-dependent game validation: when the
requested Linq target has no route and its thread identity is the source
identity of an adopted move whose container is the calling member, resolve to
that container's one current route, return that chat id with the container's
conversation locator, and validate the game against the resolved destination.
`readHostedThreadRouteByThreadIdentity` itself does not follow aliases. The
send-time exact-route fence is unchanged. Effects already bound to provider
message ids (native replies, reactions) are not translated.

### Games during overlap

In the game audience normalization in `apps/web/src/lib/game/chat-membership.ts`,
a handle counts as Murph when it is the verified source or target service number
of a `reserved` or `adopted` move for that container. No other handle is
exempted, and `audienceKey` is not rewritten.

### Operator surface

`/api/ops/linq-group-line-move`, same guard as `ops/linq-rehome`.

- `start`: requires a quiet chat (no inbound for a short window) and no queued
  provider-bound work for the container; validates the route, iMessage group,
  and an assignable target line that can send; reserves the row; then adds the
  target number from the source line; then sends the marked notice through the
  existing delivery claim with a stable effect id (new template
  `group_line_move`).
- `resume`: re-drives from provider truth. An unknown add outcome is settled by
  reading the old chat's roster, not by a blind retry.
- `cancel` (pre-adoption only): the source line removes the target number, the
  removal is verified by a roster read, then the row is cancelled and protection
  released.
- `retry_leave`: after adoption, using `source_cleanup_encrypted`.
- `GET`: rows by status, hints only.

The adoption webhook schedules the leave after its response; `retry_leave`
covers failures.

### Release order

- **PR A (consumer, inert without rows):** migration and store, the base
  operation, ingress rules, egress alias, game overlap normalization, tests.
  Deployed and drained before any producer exists. This is the rollback floor.
- **PR B (producer):** Linq client add, remove and leave; notice template; ops
  endpoint; resume and cancel; tests.
- **Production proof:** a throwaway group first, including a person texting
  during the handoff and an interrupted request; then a live-game group. Each
  needs explicit owner go-ahead.
- The duplicate container left by the 2026-11-10 test is repaired separately.

## Tasks (revised)

1. PR A as above.
2. PR B as above.
3. Production proof.
4. One-off repair of the test duplicate.


## PR A implementation checkpoint — 2026-11-10

Status remains active. Consumer implementation is locally verified; PR B,
release, provider proof and repair remain outstanding. No producer, ops endpoint,
notice template, provider mutation, production access, push, PR or ReviewGPT run
was performed for this step.

Persisted State Placement Gate: this is hosted routing/control truth, retained
in the existing Web Postgres owner. It is not canonical member memory, a runner
operation or a second roster projection. The cleanup payload has a strict v1
schema and container/move authenticated encryption. Rows cascade on container
deletion; adopted/left rows otherwise retain alias and tombstone authority.
`ARCHITECTURE.md` and `SECURITY.md` own the current contract.

Changelog: not applicable. This consumer-only release has no usable new member
behavior until a separately shipped producer creates a reservation.

### Interpretation and producer requirements

- Exact notice correlation hashes one untrimmed signed wire text part. Multiple
  parts or normalized display text do not authorize adoption. PR B must freeze
  the final notice bytes and unique marker before sending through its stable
  delivery claim.
- Automatic adoption requires iMessage, both active destination service handles,
  each chat's own self handle, complete provider results of at most 32 handles,
  and evidence no more than 30 seconds old. These explicit conservative bounds
  make "freshly verified" executable; larger or slower cases retry/hold.
- A reserved source holds all non-self traffic, including service speech that
  cannot safely be classified as a person. Own echoes keep existing ignore
  behavior. Inconclusive target rosters hold because absence of the source
  service number is not proven. Expiry does not cancel.
- A previous adopted overlap must reach verified `left` before another adoption
  for that container. More than one relevant overlap fails closed at the game
  boundary. A retired source chat cannot be recycled as a destination.
  Open product question for PR B: confirm these sequential-move limits and the
  30-second/32-handle bounds before exposing operator recovery.
- The shared replacement primitive also enforces the adoption deadline for
  future explicit ops callers. Open question for PR B: should exact-destination
  recovery renew that deadline after fresh proof? Automatic notice authority
  must never be renewed merely because a delayed marker arrived.
- Egress aliases apply only to initial thread-send preparation. Native replies,
  reactions, typing and dispatches already bound to an exact resolved route
  are not translated. A final dispatch retains the conversation locator only
  for a persisted adopted/left destination. General route readers are unchanged.
- The CREATE TABLE migration needs no incompatible-change inventory allowance;
  the existing production migration guard accepts it.
- PR B must use `prepareHostedLinqGroupMoveCleanup` before its reservation
  transaction, take the existing raw-chat locks, and use rotation read
  candidates when rejecting duplicate source/target reservations. Partial unique
  indexes protect equal stored key versions, not different versions of one
  identity. Reindex retained move keys before retiring a privacy key.
- Progress timestamps never gate notice adoption. Producer updates must be
  conditional so late add/send responses cannot overwrite adopted. Verify
  removal before `cancelled`, retain adopted on failed leave, and set `left`
  only after verified departure. Use the retained cleanup envelope after source
  route deletion. Wire post-adoption leave scheduling in PR B.
- The base replacement primitive accepts already verified/prepared authority;
  exact-destination ops recovery must perform the same complete two-roster
  proof before calling it. PR A's automatic preparation is marker-specific.
- Deploy/drain move-aware Web before any reservation or provider effect. This
  consumer is the rollback floor even with zero queued schedules. No live
  provider compatibility or end-to-end runner/provider delivery is claimed.

### Query and fanout evidence

The Postgres suite uses real local encryption and Prisma query events:

| Group webhook path | Added move-consumer work |
| --- | --- |
| Empty table / unrelated receiving line | Two bounded move SELECTs, no extra provider read |
| Reserved source hold | Same two SELECTs, no extra provider read |
| Unbound chat on reserved target | Two move SELECTs plus one control-root metadata read; one fresh destination roster read |
| Adopted destination / source echo | Two move SELECTs plus one control-root metadata read; no extra provider read |
| Retired source tombstone | Two move SELECTs; no crypto/provider read |
| Exact eligible notice | Five preparation SQL statements, two complete provider roster reads; 16 SQL statements in the adoption primitive's transaction, excluding BEGIN/COMMIT |

The exact-notice counts describe the move preparation and replacement primitive,
not the entire webhook or an additive delta against ordinary admission. A roster
mismatch adds one conditional diagnostic UPDATE. Existing request-scoped root
metadata reuse can lower crypto-read counts. Existing demotion work can vary
with pre-existing personal bindings; no new per-participant SQL loop is added.
Separate from webhook costs, eligible egress preparation and game audience
reads each add one bounded lookup when the move table is empty.
The pre-existing direct planner 20-statement pin still passes. Move reads cap at
five rows, the route replacement at three, and game overlap at three; ambiguity
fails closed rather than reading unbounded history.

### Local verification

Prisma's default config unconditionally reads local dotenv files. This task
used an ignored `.tmp/prisma-no-env.config.ts` containing only `defineConfig`,
the repository schema/migration paths and the isolated local test database URL.
No dotenv file or production credential was read. The limitation is recorded in
`.agents/friction-log/20261110124919-prisma-configuration-has/friction.md`.

Preparation (all passed):

```sh
pnpm install --frozen-lockfile --prefer-offline
PGPASSWORD=postgres createdb -h 127.0.0.1 -p 5432 -U postgres murph_test_linq_group_move
pnpm --dir apps/web exec prisma generate --config ../../.tmp/prisma-no-env.config.ts
pnpm --dir apps/web exec prisma validate --config ../../.tmp/prisma-no-env.config.ts
pnpm --dir apps/web exec prisma migrate deploy --config ../../.tmp/prisma-no-env.config.ts
```

Final unit/regression selection: 13 files, 588 passed, one existing conditional
skip (`MURPH_VERIFY_GAME_SKEW`, requiring a separately pinned old Web checkout).

```sh
pnpm exec vitest run --config apps/web/vitest.config.ts \
  apps/web/test/hosted-linq-group-line-move.test.ts \
  apps/web/test/hosted-onboarding-linq-thread-route.test.ts \
  apps/web/test/hosted-onboarding-linq-egress-engagement.test.ts \
  apps/web/test/game-chat-membership.test.ts \
  apps/web/test/hosted-thread-delivery-route.test.ts \
  apps/web/test/hosted-thread-delivery-route-repair.test.ts \
  apps/web/test/hosted-onboarding-linq-webhook.test.ts \
  apps/web/test/hosted-onboarding-linq-webhook-graph-boundary.test.ts \
  apps/web/test/hosted-onboarding-webhook-idempotency.test.ts \
  apps/web/test/hosted-onboarding-webhook-db-timing.test.ts \
  apps/web/test/game-chat-delivery.test.ts \
  apps/web/test/game-chat-delivery-authority.test.ts \
  apps/web/test/production-migration-guard.test.ts --maxWorkers 2
```

Final migrated Postgres selection: four files, 78 passed (25 new move tests).
Provider reads/sends are synthetic; transaction rollback, locking checks,
privacy-key rotation, authenticated cleanup, game audience and mailbox writes
use the real migrated database. The exact replacement succeeds while domain-root
provider calls are explicitly disabled. Both human-message copies are held
before adoption and only one target copy enters the mailbox afterward, in either
order and on replay. Real endpoint tests resolve five queued game notice types
before game validation and retain the exact dispatch fence; a real persisted
game validates its recap audience on the new route without changing its record.

```sh
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/murph_test_linq_group_move \
MURPH_TEST_POSTGRES_CONCURRENCY=1 \
pnpm exec vitest run --config apps/web/vitest.config.ts \
  apps/web/test/hosted-linq-group-line-move-postgres.test.ts \
  apps/web/test/hosted-onboarding-linq-roster-observation-postgres.test.ts \
  apps/web/test/hosted-onboarding-linq-home-routing-postgres.test.ts \
  apps/web/test/game-chat-roster-observation-postgres.test.ts --maxWorkers 1
```

Web typecheck and changed-file lint passed:

```sh
pnpm --dir apps/web typecheck:prepared
pnpm --dir apps/web exec oxlint \
  app/api/internal/hosted-runtime/linq-egress/engagement/route.ts \
  src/lib/game/chat-membership.ts \
  src/lib/hosted-onboarding/linq-egress-engagement.ts \
  src/lib/hosted-onboarding/webhook-provider-linq.ts \
  src/lib/hosted-onboarding/webhook-service.ts \
  src/lib/hosted-routing/thread-container-service.ts \
  src/lib/hosted-routing/linq-group-line-move-ingress.ts \
  src/lib/hosted-routing/linq-group-line-move-store.ts \
  test/game-chat-delivery.test.ts \
  test/game-chat-membership.test.ts \
  test/hosted-onboarding-linq-egress-engagement.test.ts \
  test/hosted-onboarding-linq-thread-route.test.ts \
  test/hosted-linq-group-line-move-postgres.test.ts \
  test/hosted-linq-group-line-move.test.ts
pnpm complexity:diff
git diff --check
pnpm docs:drift
pnpm docs:gardening
```

Both documentation checks passed; gardening reported zero issues.

Initial verification iterations exposed missing fixture delegates, type errors
and increased function complexity; those were corrected and the listed final
checks pass. Root `pnpm exec oxlint` was unavailable; the Web-owned executable
above is the working equivalent. Default `pnpm --dir apps/web typecheck` was
not used because it invokes the dotenv-reading Prisma config; the prepared
command ran the full Web compiler after explicit no-dotenv generation.
CI, ReviewGPT, real-Codex journeys and live provider proof were not run. There
are no changed prompts/tools or model-dependent decisions in this consumer.

## PR B silent producer checkpoint — 2026-11-10

Status remains active. This is a local implementation checkpoint, **not a
completed PR B or a release approval**. The requested later adoption after a
source fallback still needs reliable cross-line message correlation. No push,
PR, production access, real Linq API, dotenv read or ReviewGPT was performed.

### Implemented and retained

- Reused the partial ops route, inventory phone lock, roster validation,
  encrypted cleanup, quiet-work checks, reservation, resume, cancel, overview
  and leave code. The only route writer remains PR A's replacement primitive.
- Deleted the partial notice module, notice rendering/hash/send/claim path and
  both notice-specific delivery-store exceptions. No template or marker remains
  in executable code. The legacy notice/progress columns remain for rollout.
- Added the forward nullable-hash migration without changing PR A's migration;
  all new move selects omit the hash. Old Web must drain before new null-hash
  reservations are created, since its generated client expects non-null data.
- Any first iMessage group message can authorize adoption through the reserved
  target line and complete equal rosters. Source speech is consumed; a person's
  event commits adoption, schedules leave after response, and throws the
  existing retryable 503. Its unchanged redelivery enters the existing bound
  group path and original event-id mailbox deduplication.
- A 60-second source hold uses the signed event's original creation time. The
  transaction that admits overdue source input also expires adoption. Expiry
  allows source traffic while retaining target admission protection. No new
  retry owner, receipt table, message-content hash or route writer was added.
- Complete roster reads verify removal and departure. Too-small groups and
  refused leaves retain adopted state. Provider errors expose only fixed
  operation names and numeric status/code metadata, never provider prose.
- GET pages at most 50 moves and 50 candidate containers; candidate references
  are opaque route lookup keys, with container hints, last mailbox activity and
  live-game presence. Existing ops exposes no group-title hint to reuse, so no
  new private-title projection was introduced.

### Deliberate deviations and unresolved authority

1. **Later adoption after a source fallback is unfinished.** The reservation
   remains present but its deadline is expired atomically with source admission.
   Cancel/restart is required for another attempt. This is the conservative
   choice pending a provider guarantee for a shared message identity; sender,
   text or timestamp similarity alone is not proof of one physical message.
2. **Ambiguous adds do not immediately release their reservation.** Rejected
   requests plus verified absence cancel cleanly. An in-flight, timed-out or
   queued add can still take effect after an absence read. It is disarmed and
   reports `add_outcome_unknown` or its preserved `add_unconfirmed` provider code; source admission resumes and target admission
   stays protected. Later positive presence permits verified remove/cancel.
   This preserves safety under concurrent cancel and add. The requested clean
   cancellation of every unconfirmed add requires a provider terminal-outcome
   guarantee that the current API contract does not supply.
3. Roster equality protects different audiences and bound destinations. It
   cannot distinguish two **unbound** candidates containing identical people
   and both verified service numbers. The first qualifying candidate can win.
   The bound second-group case is tested; the indistinguishable unbound case
   remains a release question under the owner's chosen correlation contract.
4. Kept the prior 60-second quiet-start check, pending-work rejection, 32-handle
   cap, 30-second roster freshness, iMessage requirement and sequential-overlap
   limit. These are the conservative existing-owner constraints.
5. A human photo follows the same adoption/retry path. Empty or otherwise
   unsupported content retains ordinary bound-group behavior on redelivery;
   the move does not invent a reply policy for such events.

Product UX verdict: **Hold** for the complete requested journey, because item 1
is not implemented. The synthetic normal handoff, source-service first event,
photo first event, source availability on expiry, ambiguous-add protection,
verified cancel and too-small/refused leave paths have deterministic proof.
The synthetic reply harness consumes the one accepted mailbox input and uses
real egress authority with a fake Linq SDK; it is not a live runner/model proof.
Changelog: none for this incomplete internal ops checkpoint.

### Operator request contract (for review; no production execution)

All requests use the existing ops access guard. POST additionally requires the
same-origin mutation check. Opaque values come from GET; do not supply phones,
raw chat ids or member ids.

```http
GET /api/ops/linq-group-line-move?status=reserved&sourceLineLookupKey=<opaque-line-key>
```

GET has no body. Optional `status` is `reserved`, `adopted`, `left` or
`cancelled`; omit it for all statuses. `sourceLineLookupKey` includes the
candidate page. Continue with `afterMoveId=<nextMoveId>` and/or
`afterContainerRef=<nextContainerRef>`, preserving the filters. The response has
`moves`, `assignableTargetLines`, `candidates`, and nullable next cursors.

```json
{"operation":"start","containerRef":"<opaque-container-ref>","targetLineLookupKey":"<opaque-line-key>"}
```

```json
{"operation":"resume","moveId":"00000000-0000-4000-8000-000000000001"}
```

```json
{"operation":"cancel","moveId":"00000000-0000-4000-8000-000000000001"}
```

```json
{"operation":"retry_leave","moveId":"00000000-0000-4000-8000-000000000001"}
```

POST responses are the move summary itself, not an additional envelope:
`moveId`, `containerHint`, source/target blinded line keys, `status`, deadline,
`adoptionExpired`, `holdActive`, `sourceHoldActive`, progress timestamps and
nullable `code`. `holdActive` means the reservation still protects target
admission; `sourceHoldActive` reports whether source messages can still wait.

- `reserved`, non-null `addConfirmedAt`, `code: null`: target presence verified;
  waiting for a qualifying group message. Normal deadline is 24 hours.
- `adopted`: destination is authoritative permanently; leave is still pending.
- `left`: source departure verified. Repeated leave/resume is a no-op.
- `cancelled`: pre-adoption cleanup verified and the reservation released.
  The immutable cancellation timestamp continues fencing old unbound target
  events for 30 minutes. A restart requires a new event created at or after
  its add claim; delayed copies cannot adopt or duplicate source work.
- `adoptionExpired: true`: source remains authoritative; resume does not renew.
  Cancel verifies target removal. `source_hold_expired` identifies automatic
  disarming; resume may subsequently report `adoption_deadline_elapsed`.
- `add_outcome_unknown` or `add_unconfirmed` (possibly with a provider suffix): disarmed but provider add is not terminally settled;
  retain the reservation, then retry cleanup from fresh provider truth.
- `remove_pending`: one removal was accepted, but target absence is not yet
  verified. Repeat cancel to reconcile fresh rosters; it never sends another
  removal. Both source and target remain reserved until cleanup settles.
- `remove_outcome_unknown` or a removal error with non-null `removeStartedAt`
  and null `removeAcceptedAt`: a dispatch may still be outstanding. Repeated
  cancel cannot release the reservation, even on absence, or repeat removal.
  Wait for the original request's receipt. If it was interrupted or lost its
  receipt, separately investigate and establish that it cannot still dispatch
  before any explicitly reviewed repair; never clear the claim based on elapsed
  time or roster absence alone. No automatic recovery from this ambiguous
  boundary is claimed.
- `leave_pending`, `leave_requires_four_participants`, or other
  operation/provider error codes: inspect the named effect and repeat the
  appropriate recovery action after resolving the condition.
- Validation/auth errors are HTTP 400/403/404/409. A 200 summary with a non-null
  code is an operation result requiring inspection, not proof of completion.

### Verification commands and evidence

Prisma used an ignored explicit local config; root typecheck used an ignored
Node preload replacing `process.loadEnvFile` with a no-op. This reuses the
existing Frog entry about mandatory dotenv reads. The preload contains no
credentials or personal paths. Command output was redacted before persistence.
All provider fixtures are synthetic; database work uses only the isolated local
`murph_test_linq_group_move` database.

```sh
scripts/frog list
pnpm --dir apps/web exec prisma generate --config ../../.tmp/prisma-no-env.config.ts
pnpm --dir apps/web exec prisma validate --config ../../.tmp/prisma-no-env.config.ts
pnpm --dir apps/web exec prisma migrate deploy --config ../../.tmp/prisma-no-env.config.ts
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/murph_test_linq_group_move \
MURPH_TEST_POSTGRES_CONCURRENCY=1 \
pnpm exec vitest run --config apps/web/vitest.config.ts \
  apps/web/test/hosted-linq-group-line-move.test.ts \
  apps/web/test/hosted-linq-group-line-move-postgres.test.ts \
  apps/web/test/hosted-linq-group-line-move-producer-postgres.test.ts \
  apps/web/test/hosted-ops-linq-group-line-move-route.test.ts \
  apps/web/test/hosted-onboarding-linq-http.test.ts \
  apps/web/test/hosted-onboarding-privacy-foundation-migration.test.ts --maxWorkers 1
MURPH_APP_VITEST_MAX_WORKERS=2 pnpm --dir apps/web test
NODE_OPTIONS="--require=$PWD/.tmp/skip-dotenv.cjs" \
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/murph_test_linq_group_move \
pnpm typecheck
pnpm --dir apps/web typecheck:prepared
pnpm --dir apps/web lint
pnpm complexity:diff
pnpm docs:drift
git diff --check
```

Initial focused iterations corrected query-count expectations, the inherited
runtime-owner fixture, the second-room fixture, and a fake roster outage that
only failed the preliminary read instead of the authoritative read. New HTTP
proof exposed that the old error-code helper only allowed avatar codes; group
mutations now preserve bounded numeric provider codes without provider prose.
The initial full Web run had 14,591 passes, 2,390 skips and three failures from
HTTP summary fixtures missing the new `service` field. The migration reviewed
list now includes the forward migration. The supplied main already includes
PR A's mock-delegate fixes; the full run found no missing delegate failures.

Final focused selection: six files, 158 tests passed. This includes 26 PR A
consumer Postgres scenarios and 31 producer Postgres scenarios. Final inspection
found that a failed confirmation roster read after a successful add bypassed
disarming. The add and its confirmation read now share the cleanup error path;
both unavailable and incomplete confirmation cases have Postgres proof.
Prisma generate, validate and all 282 migrations passed against the local test
database. Root typecheck passed with dotenv disabled; Web typecheck, Web lint
(existing warnings only), complexity, docs drift and diff whitespace passed.
The second full Web attempt had 14,606 passes, 2,398 skips and three new numeric
provider-code test failures; those are fixed and pass in the focused selection.
Full Web run before the confirmation-read fix: **872 files passed, 159 files
skipped; 14,609 tests passed, 2,398 skipped; zero failures** (431.30 seconds).
Root typecheck (including Web), Web lint and complexity passed again after that
fix. The next full run overlapped root typecheck's Prisma regeneration and
failed to collect `hosted-onboarding-env.test.ts` because
`.prisma/client/default` was temporarily absent: 871 files and 14,582 tests
passed, 159 files and 2,400 tests skipped, one collection failure. All 27 tests
in that suite passed alone afterward:

```sh
pnpm exec vitest run --config apps/web/vitest.config.ts \
  apps/web/test/hosted-onboarding-env.test.ts --maxWorkers 1
```

The shared-artifact race is recorded in
`.agents/friction-log/20261110150031-concurrent-root-typecheck/friction.md`.
The final full Web rerun ran after generation: **872 files passed, 159 files
skipped; 14,609 tests passed, 2,400 skipped; zero failures** (347.23 seconds).

The normal full suite skips opt-in database/live-provider lanes; the separate
local Postgres selection above supplies this task's database evidence. No CI,
live Linq call, live model/runner journey, production proof or ReviewGPT was
run. The required later-message adoption after source fallback and the
indistinguishable unbound second-group case remain unproved as described above.

The reviewed files form a local checkpoint for `scripts/committer`; the active
plan remains open. This checkpoint is not a claim that PR B is ready to ship.

### Round 1 finding dispositions

1. **High — cancelled target replay: accepted, fixed locally.**
   `linq-group-line-move-store.ts` retains recently cancelled target-line rows
   in the existing five-row read. Their final `updatedAt` is immutable at these
   owners and fences events created at or before cancellation. The new composite
   index bounds the target/status/time lookup. The 30-minute retention follows
   Linq's documented total retry window **from event creation**:
   https://docs.linqapp.com/channel/imessage/guides/webhooks/#delivery-guarantees.
   `linq-group-line-move-ingress.ts` enforces `addStartedAt` before adoption and
   after the new destination is bound. Unusable creation times fail closed.
   No current-membership check substitutes for the replay boundary. Because an
   unadopted move has no target-chat identity, recent cancellations conservatively
   consume older unbound events on the target line; unrelated bound routes keep
   their authority. More than four candidate relations still fails closed.

   The producer Postgres source-fallback test now covers four combinations of
   held-target ordering and replay before/after restart. It checks unchanged
   container, route and mailbox counts (including activation), settles source
   work, restarts, rejects the old copy before and after fresh adoption, admits
   the fresh request once and leaves once. Consumer regressions cover an event
   before add, no add claim, missing/invalid/future creation times, the 30-minute
   lookup bound and overflow. Before the fix, both source-fallback orderings
   produced a second container, route, activation and conversation input.

2. **High — overlapping removal: accepted, fixed locally.**
   `linq-group-line-move.ts` claims removal once under the source-chat lock;
   `linq-group-line-move-state.ts` exposes its two progress timestamps.
   `schema.prisma` and only the unmerged
   `20261110190000_linq_group_line_move_silent` migration add nullable
   `removeStartedAt` and `removeAcceptedAt`. A pending claim retains `reserved`
   even if a concurrent roster reports absence. A successful provider return
   and verified absence permit cancellation. Claim/finalization predicates
   prevent stale observations from releasing or redispatching the effect;
   a lost claim stops before the provider call. Concurrent/replayed cancels
   only reconcile, never issue another removal.

   Producer regressions pause a positive-roster cancel while a second settles
   and a restarted move adopts; releasing the stale request cannot remove the
   new destination. A second race pauses the removal owner before its effect,
   exercises overlapping cancels with both presence and absence, rejects
   restart/adoption while dispatch remains possible, then permits restart
   after cleanup. Queued-removal replay now explicitly asserts one call.
   Interrupted removal before its receipt remains reserved; interruption after
   the receipt recovers from absence without redispatch. Existing interrupted
   add and queued-removal cases remain in the focused suite. Before the fix,
   the races issued two removals and falsely released a live removal claim.

The operator runbook above now distinguishes accepted pending removal from a
missing receipt. An interrupted or ambiguous removal without a durable receipt
cannot be automatically released from absence: it requires separate investigation
and an explicitly reviewed repair once the old request cannot dispatch. This
deliberate safety limit is not a new retry mechanism. The earlier same-reservation
source-fallback and identical-unbound-roster limitations remain outside these
two findings; a fresh message after verified cancel/restart is now proved.

Deployment skew remains governed by **start no move until all Web instances
converge and old instances drain**. The merged #4792 migration is untouched;
the extension adds nullable columns and an index, with no new status values.
Existing old-shape rows remain readable. New silent/null-hash reservations and
their replay/cleanup protections require this producer/consumer revision, so
the convergence gate remains necessary and sufficient before the first move.
No runner or Cloudflare change is needed. No production rollout or real provider
behavior was exercised. The architecture owner documents the new invariants.

Product UX patch walkthrough: local synthetic real-webhook/Postgres journeys
preserve the original group and process only the fresh target request after
restart. Cleanup overlap cannot remove the new receiving line. These two
regressions are Ready locally; the existing broader PR release Hold remains.
No separate public changelog entry is added for this pre-release operator-path
correction. No assistant prompt, tool schema or runtime policy changes.

### Round 1 verification

All commands ran locally with synthetic provider fixtures. Prisma's explicit
ignored config targets a newly created isolated local test database and loads
no dotenv files. Root typecheck reused the existing no-dotenv Node preload;
it ran after the first full Web suite finished, before the final full rerun.
The existing Frog entries cover that workaround, the Prisma regeneration race
and the full suite's SWC cache residue; no new repository friction was created.

```sh
scripts/frog list
pnpm --dir apps/web exec prisma generate --config ../../.tmp/prisma-no-env.config.ts
pnpm --dir apps/web exec prisma validate --config ../../.tmp/prisma-no-env.config.ts
pnpm --dir apps/web exec prisma migrate deploy --config ../../.tmp/prisma-no-env.config.ts
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/murph_test_linq_group_move_review_final \
MURPH_TEST_POSTGRES_CONCURRENCY=1 \
pnpm exec vitest run --config apps/web/vitest.config.ts \
  apps/web/test/hosted-linq-group-line-move.test.ts \
  apps/web/test/hosted-linq-group-line-move-postgres.test.ts \
  apps/web/test/hosted-linq-group-line-move-producer-postgres.test.ts \
  apps/web/test/hosted-ops-linq-group-line-move-route.test.ts \
  apps/web/test/hosted-onboarding-privacy-foundation-migration.test.ts \
  apps/web/test/production-migration-guard.test.ts --maxWorkers 1 --silent
MURPH_APP_VITEST_MAX_WORKERS=2 pnpm --dir apps/web test
NODE_OPTIONS="--require=$PWD/.tmp/skip-dotenv.cjs" \
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/murph_test_linq_group_move_review \
pnpm typecheck
pnpm --dir apps/web lint
pnpm complexity:diff
pnpm docs:drift
git diff --check
```

Results: Prisma generate and validate passed; all 282 migrations applied
to a fresh local database, including the final forward migration. The final
focused selection passed **6 files, 180 tests** (41.07 seconds), including
32 consumer and 37 producer Postgres cases. Root `pnpm typecheck`, Web lint
(existing warnings only), complexity and whitespace checks passed. The
complexity diff adds no debt; the listed pre-existing webhook hotspots are
unchanged. Ingress still uses two bounded move reads, with no new provider or
crypto work for the replay fence; the real-query-count consumer proof passed.

The first full Web suite had 14,606 passes, 2,412 skips and three failures,
all from the migration guard rejecting an unnecessary new CHECK constraint.
The constraint was removed: the claim owner already enforces receipt ordering,
and the migration is now only nullable columns, nullable legacy hash and an
index. The final migration and guard both passed in the focused selection.
The final full Web rerun passed **872 files, 14,609 tests**, with 159 files and
2,412 opt-in tests skipped, **zero failures** (336.63 seconds). The separate
focused selection supplies the actual Postgres evidence. Docs drift and final
diff whitespace passed, and authored additions passed the privacy scan.
Parent review found no further gap in either accepted finding. The active plan
and the scoped fix are ready for the authorized local `scripts/committer` commit.

No push, PR edit, production access, real Linq API call, dotenv read, new
ReviewGPT round or CI run occurred. This remains an active local checkpoint.


## Round 2: cancellation history and unaffected groups

ReviewGPT round 2 reviewed `6eba8aa37655e120cfe36ec95136bd227781d29a`
in the existing Mountain conversation with a full guarded snapshot, confirmed
GPT-6 Pro request and completed `REVIEW_COMPLETE` response. It found one High
review-induced bug. Accepted: five ordinary rejected-add/cancel operations
produce five cancellation receipts, exhausting the shared ingress cap before
an unrelated bound route can continue. This interrupts every group on the
target line despite those receipts granting no routing authority.

The regression creates five cancellations through the real producer with a
fake SDK returning HTTP 403. Before the fix, a human message to a separately
bound group fails with the ambiguity error. The correction keeps the original
five-row cap for route authority and reads only the latest recent cancellation
using the existing target/status/update-time index. Older receipts cannot
increase the replay cutoff, so reading them adds no information. No new state,
migration, lifecycle or authority path is introduced.

Preparation and transaction revalidation each run two serial bounded reads,
increasing ordinary group ingress from two to four SQL reads with peak one
connection per phase. Provider calls and transaction ownership are unchanged.
The cancellation row remains in the prepared fingerprint, preserving locked
revalidation. The composed proof covers one unrelated group admission/reply,
consumption of an old unbound event, a fresh move's successful adoption, and
continued failure for genuinely ambiguous active rows.

This correction remains within the reviewed ingress/query boundary and changes
no persisted design. Per the completion workflow, prove it and complete CI;
a third ReviewGPT round is not required merely to confirm the fix.


Round-2 correction verification:

- Red: the new producer scenario `after five rejected moves` failed at the
  ordinary bound-group webhook with `HOSTED_LINQ_GROUP_LINE_MOVE_AMBIGUOUS`.
- Green: the consumer and producer Postgres suites passed all 70 tests against
  the existing isolated local database using `MURPH_TEST_POSTGRES_CONCURRENCY=1`
  and `pnpm exec vitest run --config apps/web/vitest.config.ts --maxWorkers 1`.
- The thread-route, egress-engagement, mailbox-root-prewarm, move unit and ops
  route suites passed 425 tests with the same config and two workers. Their
  narrow no-move mocks now include the latest-cancellation lookup.
- Root `pnpm typecheck` passed with explicit local DATABASE_URL and the existing
  no-dotenv verification preload. Web lint passed with existing warnings;
  `pnpm complexity:diff`, `pnpm docs:drift`, `git diff --check` and the added-line
  privacy scan passed. The measured ingress count is four bounded move reads;
  adoption preparation is six statements and the adoption transaction remains
  sixteen, with provider/KMS work disabled during the transaction proof.
- The prior full Web run passed 14,609 tests. The final correction uses focused
  local proof above and fresh full exact-head CI; the prior full run is not
  presented as proof of the later changed files.

Parent final review accepts the maximum-cutoff reduction and preserves both
round-1 fixes. All accepted findings are locally resolved. The code is Ready
for exact-head CI and merge; real-group execution remains Hold for deployment
convergence and the separately authorized provider proof.

Final-head CI found one additional narrow fixture in the dispatch suite that
omitted `findFirst` for the latest cancellation lookup. Adding its empty-history
response restores all 234 dispatch tests; no production behavior changes.
The other Web shards passed. Fresh exact-head CI remains the merge gate.
