# Move a group chat to another Murph line

Status: active
Created: 2026-11-10
Updated: 2026-11-10

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

This section is the specification. Where it differs from the first draft, this
section wins.

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
