# Linq group risk ledger

Status: completed
Created: 2026-11-15
Updated: 2026-11-15

## Why

Murph's Linq line keeps landing in large bot-ring group rooms: about 190
separate Linq chat ids since Nov 12, each with 45 to 61 handles, 40 of which
appear in every single room. They are other AI assistants greeting each other
and posting subscription links. Murph sent nothing into any of them, because
the oversized rule (#4890) marks them left locally and ignores their inbound.
The owner wants to stop this from becoming a spam or free-AI-usage vector, to
know who is doing it, to ban them, and to keep the data a later risk model
needs.

Three findings shape the design:

1. **Provider leave does not stick.** `POST /v3/chats/{id}/leave` returns 202
   "queued", but for many of these rooms Murph's own handle stays `active`.
   A manual sweep of 139 rooms left 22 confirmed removed after five minutes.
   The SDK documents leave for iMessage groups with 4 or more active
   participants; 409 code 2015 means fewer than 4 active and cannot be left;
   409 code 2013 means already left. Today we make one post-commit attempt and
   never look again, so provider state silently drifts from the local marker.
2. **Linq never says who added Murph.** `participant.added` carries the added
   handle, `added_at`, `chat_id` and the participant object; `chat.created`
   carries the roster. Neither has a creator or actor field. The ledger can
   rank repeated co-participants and observed speakers. It cannot prove who
   added Murph.
3. **One room becomes many chat ids.** Big mixed iMessage/RCS rooms reappear
   under a new Linq chat id on each roster change (see the comment on
   `planHostedLinqUnboundGroupChatWebhook`). Distinct chat ids are not
   independent invitations. Linking them by shared handles turns the noise
   into an actor-level signal.

Today the durable webhook record (`hosted_linq_provider_event`) keeps no
handles, and its diagnostic JSON expires after 7 days. Nothing lets an operator
ask "which numbers keep putting us in rooms we reject?"

## Ownership split

- Members (a `hosted_member` row) are banned with the existing
  `hosted_member.suspended_at`, built separately as an Ops Suspend/Restore
  action. Every member access path already honors it.
- Non-member handles (ring bots, unknown numbers) use this plan's block list.
  A block is an ingress block on a handle, never an account suspension.
- Free-usage guarding for members is out of scope here.

## Non-goals

- No raw message text and no plaintext third-party phone numbers at rest.
  Linq stays the source of truth for rosters and content. Blind indexes give
  the cross-room linkage a model needs. The one protected (encrypted) handle
  value is on block rows, because a block must survive key rotation.
- No classifier, score, stored ring id or cluster manager in v1. Overlap is a
  query.
- No change to member-facing behavior for normal groups.
- No message counters in v1 (see review item 5).

## Design

### 1. Sender block predicate (one check, at ingress)

One deterministic `isHostedLinqSenderBlocked(contact)` over
`HostedLinqParticipantContact`, reusing its normalization and
`createHostedLinqParticipantContactLookupKeyReadCandidates` (phone and email
handles, current plus prior key versions).

Called in `webhook-service.ts` after webhook authentication and enough event
parsing to know the sender, before `startInstantFirstTurnGeneration`, the
`message.edited` branch, reaction work and `runPlan`. A blocked sender's event
gets a plain ignored response: no generation, mailbox append, delivery claim
or wake. It applies to bound rooms too (sender work is suppressed; the room
and its games stay).

### 2. Roster rejection (unbound rooms only)

An unbound group whose active, non-self roster contains a blocked handle is
left exactly like an oversized room, with a new marker reason
`blocked_participant` (reason expansion follows the #4891 migration pattern,
which keeps old writers valid). The check lives in admission, on the roster
admission already fetches for every unbound group message
(`resolveHostedLinqPendingGroupParticipantMemberIds`), right after the size
cap. The old `pendingGroupRosterOversized` flag became
`pendingGroupRosterRejection` (`oversized` | `blocked_participant`), so both
rejections share one path: no container preparation, an ignored plan
(`group-roster-oversized` or `group-roster-blocked`) and the existing
departure. Positive evidence of a blocked handle is enough; it needs no
complete roster. Bound rooms are never auto-left because of a co-participant.

### 3. Observation ledger

Two tables, written in one narrow transaction per eligible event
(`message.received`, `participant.added`, `participant.removed`).
`chat.created` is not subscribed today and stays out of v1.

`hosted_linq_group_sighting`, PK the Linq chat lookup key:

- `line_lookup_key`, `first_observed_at`, `last_observed_at`,
  `provider_chat_created_at`, `service`, `roster_handle_count`,
  `roster_complete` (from the roster observation contract, no ad hoc
  truncation flag)
- `leave_marker_key`: nullable FK to `hosted_linq_group_leave`
  (`thread_identity_lookup_key`), `ON UPDATE CASCADE`, `ON DELETE SET NULL`.
  Both lookup keys are computed while the raw chat id is in hand. The sighting
  never owns departure authority, and expiring it never touches the marker.

`hosted_linq_group_handle`, PK `(chat_lookup_key, handle_lookup_key)`:

- `handle_lookup_key`: contact-privacy blind index (current version)
- `first_seen_at`, `last_seen_at`, `first_seen_via`
  (`roster` | `participant_added` | `sender`), `first_sent_at` (nullable; the
  first-speaker signal)
- Murph's own line handle is excluded.

Writes are idempotent upserts with min/max timestamp semantics, so planner
re-entry, provider retries and delayed events cannot inflate or regress
anything. There are no counters to double count.

Placement: two writers, both fail-open and neither reads a provider roster.

- Event evidence runs before the group-left early return
  (`readHostedLinqGroupLeftWebhookResponse`), so rejected rooms keep producing
  evidence: sender rows, `participant.added` rows and Murph's own removal. It
  is database only. A participant event, which carries no group flag, is
  recorded only for a room already marked or routed. After it, the early
  return is unchanged: no poll, join, mailbox, model or provider-leave work.
  Typing and delivery callbacks are not eligible.
- Roster evidence is the roster admission already fetched, written after the
  plan commits through the same post-commit seam as roster reconciliation.
  Roster metadata (`roster_handle_count`, `roster_complete`) orders by its own
  `roster_observed_at`, never by sender events.

Key epochs: sighting rows keep the key version they were written with and
carry no envelope, so they cannot be re-derived. Contact-key rotation is a
manual, documented procedure (`docs/hosted-contact-privacy-rotation.md`) that
must clear every prior-version lookup before retirement. These two tables are
evidence, not authority, so that procedure deletes their prior-version rows
instead of re-deriving them. Add both tables to that doc's list with
"deleted, not re-derived". Linkage therefore holds within one key epoch, which
is stated, not engineered around.

### 4. Handle block list

`hosted_linq_handle_block`:

- `contact_lookup_key` (PK, current version), `contact_kind`
  (`phone` | `email`), `contact_encrypted` (authenticated envelope, same codec
  pattern as `hosted_linq_group_leave.chat_id_encrypted`)
- `reason` (`bot_ring` | `spam` | `abuse` | `operator`), `created_at`

A rotation batch mirrors `rotateHostedLinqGroupLeaveBatch`: decrypt, re-derive
the current key, update. It must run before a prior key is retired. Reads and
removal search both readable versions, so rotation cannot leave a second live
block. Ops adds or removes a block from a pasted number on a new Ops section
(not `/ops/usage`); the server derives the key and envelope. Envelope and
ciphertext never appear in logs or ordinary Ops responses. Local agents never
see the keys.

### 5. Provider leave: one marker-owned attempt path

Extend `requestHostedLinqGroupLeaveAfterCommit` into one claim-based attempt
operation used by every caller (webhook oversized, Ops departure, assistant
tool) and by the sweep:

- Marker columns: `provider_leave_attempts INT NOT NULL DEFAULT 0`,
  `provider_leave_last_attempt_at` (nullable), `provider_removed_at`
  (nullable), `provider_leave_terminal_code` (nullable). Existing markers and
  old-writer inserts get 0 attempts and a null time, which counts as
  immediately eligible.
- Claim: one short transaction increments attempts and stamps the time on an
  eligible marker (no removal, no terminal code, attempts < 5, null or old
  last attempt). Then call the existing `leaveHostedLinqChat` outside any
  transaction. Then persist the outcome without overwriting a removal that
  arrived meanwhile. Reserved attempts are counted, not proven HTTP requests.
- Outcomes: 409 code 2013 sets `provider_removed_at`; 409 code 2015 sets the
  terminal code `fewer_than_four`; other errors leave the marker eligible.
- A `participant.removed` webhook whose participant is Murph's own line handle
  sets `provider_removed_at`. This is recorded before the group-left return
  (section 3). It means "Linq said removed at T", not proof of current
  absence.
- The sweep runs in `runHostedExternalRetentionCleanup` (the provider-capable
  retention owner), in a bounded batch, every tick. After the fifth
  unconfirmed attempt, one bounded `getHostedLinqChatSummary` read separates
  "verified still active" from "unconfirmed", for the Linq support ticket.
- Claims and completions use the marker key read candidates, so a rotation
  between claim and completion still lands.

### 6. Retention and account deletion

- `hosted_linq_group_handle` expires 90 days after its own `last_seen_at`.
  `hosted_linq_group_sighting` expires 90 days after `last_observed_at`, once
  it has no handle rows. A key rotation deletes prior-version rows early
  (section 3).
- Block rows and leave markers do not expire.
- Register all three tables in `HOSTED_ACCOUNT_DATA_STORE_COVERAGE` as
  independently retained global blinded evidence, the same treatment as
  existing roster evidence.

## Deploy and activation

1. Migration: three new tables, four marker columns, marker reason expansion.
   Additive; old Web keeps working and keeps honoring `blocked_participant`
   markers because it reads marker identity only.
2. Web with observation, the sender predicate, roster rejection and the
   attempt path. Observation starts at this cutover and is forward-only.
   There is no historical backfill.
3. Drain old Web instances before adding any block. From the first block on,
   this Web is the rollback floor: reverting below it disables blocking and is
   an explicit policy change, not a transparent rollback.

## Verification

- Sender block: blocked second/third opening reply, blocked edit of a
  previously accepted message, blocked reaction, all with zero generation,
  mailbox append, delivery claim or wake. The unblocked equivalents behave as
  today.
- Observation on a marked room: fresh and duplicate messages, participant
  additions and Murph's own removal advance evidence. The webhook still
  returns group-left and does no other work.
- Idempotence: one event through planning twice, concurrent duplicate delivery
  and a rolled-back transaction produce one, one and zero effects. Delayed
  events do not regress `first_*` or `last_*`.
- Blocks: old-key block against new-key inbound, phone normalization
  equivalence, email handle, removal across overlap, and a dormant block
  surviving full prior-key retirement after rotation.
- Attempts: two sweeps racing an immediate dispatch, crash after claim, lost
  provider response, 2013, 2015, unknown 409, timeout, removal before
  completion, legacy null rows, rotation mid-attempt.
- Relation: from a ranked handle, resolve the rejected room, leave reason and
  protected chat id; repeat after marker rotation; expire the sighting and
  confirm departure is still enforced.

## Already done (Nov 15, operator sweep)

Manual leave requests went to every active group room on the line with more
than 32 handles that also contained the full 40-handle ring. Every normal group
(32 or fewer handles) shared zero ring handles and was not touched. Chat ids
stay in the session, not here, because this repository is public.

## Review outcome (ReviewGPT architecture, 2026-11-15)

| # | Finding | Outcome |
| --- | --- | --- |
| 1 | Planner-only sender block misses speculative first-turn generation and the `message.edited` branch | Accepted. One predicate at ingress after auth (section 1). |
| 2 | Admission-only observation misses rejected rooms because the group-left return precedes it; `chat.created` is unsubscribed | Accepted. Observation before the early return; `chat.created` deferred (section 3). |
| 3 | A blind-index-only permanent block dies at key retirement | Accepted. Encrypted envelope plus rotation batch, mirroring the leave marker (section 4). Sightings: linkage stated as per-epoch. |
| 4 | "Old Web ignores the tables" does not make rollback safe for enforcement | Accepted. Activation order and rollback floor (Deploy). |
| 5 | Counters double-count across planner re-entry and retries; event response is not room admission | Accepted, by deletion: v1 has no counters and no generic disposition. Idempotent min/max upserts; departure comes from the marker relation. |
| 6 | A separate sweep loop duplicates dispatch; nullable attempt columns exclude legacy rows | Accepted. One claim-based attempt path, `DEFAULT 0`, null time = eligible, sweep in the external retention owner (section 5). |
| 7 | Sighting key and marker key are different HMAC domains with no relation | Accepted. Nullable FK with `ON UPDATE CASCADE`; no plaintext drill-down for unmarked rooms (section 3). |
| Q1 | Transaction placement | Accepted: evidence commits in its own narrow transaction or with the admission decision; provider I/O stays outside. |
| Q2 | Reuse chat health? | Accepted: separate table; chat health has its own authority and consumers. |
| Q3 | Blocks in bound rooms | Accepted: sender block applies; roster auto-leave stays unbound-only. |
| D | Roster contract, per-handle retention clock, account-deletion registration, attribution limits | Accepted (sections 2, 3 and 6, and Why item 2). Per-handle 90-day clock; rotation deletes prior-version evidence rows rather than re-deriving them. |


## Implementation notes

### Product UX and scope

- Outcome: an operator can add, inspect and remove a handle block; blocked
  senders remain silent and ordinary groups retain their existing behavior.
- Entry: the authenticated Ops landing page has a minimal Block number form,
  a paginated Blocked numbers list, and inline Unblock actions. Existing Ops
  authorization and mutation-origin checks protect the route. Pending, empty,
  success and recoverable failure states are explicit.
- The departure service has only an API caller in this checkout (repository
  search of `leave_group` and `linq-group-line-move`); there is no departure
  page. The form therefore lives on `/ops`, leaving `/ops/usage` untouched.
- No production access, provider requests, secret retrieval, commit, push or
  other-worktree mutation was performed. Provider tests use a synthetic HTTP
  transport; database proof uses a newly created local test database.

### Implementation decisions and deviations

- `webhook-service.ts` has only the sender predicate and early observation
  calls plus imports. The existing complete roster is local to a later helper
  in that file, unavailable to the early observer. Keeping the requested file
  boundary means unmarked, unbound groups have one extra bounded roster read
  (three seconds); marked and bound groups never fetch a roster for evidence.
  The observer uses the existing roster type, performs no ad hoc truncation,
  and leaves normal admission unchanged if that read fails. Consolidating the
  two unbound reads would require widening the explicitly restricted edit.
- Roster evidence and blocked-roster rejection share one short transaction;
  provider work and post-commit departure stay outside it. Marker claims use
  one atomic conditional UPDATE (its own database transaction), avoiding a
  redundant explicit transaction wrapper.
- Five reservations are the budget, separated by at least one hour. The
  diagnostic roster read waits until the next eligible tick after reservation
  five, letting the last queued request settle. Its claim first records
  `unconfirmed`; a crash or failed read remains truthful and never causes
  unbounded diagnostics. A positive active-self observation changes it to
  `verified_still_active`. Each external tick selects at most ten markers.
- Missing event line or provider metadata stays null. Sender and participant
  event times and fresh roster observation times remain distinct; min/max
  upserts preserve delayed-event and duplicate semantics. No inviter is inferred.
- The migration widens the leave reason constraint using the existing NOT
  VALID/VALIDATE pattern and adds its reviewed compatibility entry to the
  production migration guard. Old inserts retain default-zero attempts.
- The assistant verification skill was read. No prompt, model decision, tool
  schema or reply prose changed; deterministic ingress/DB tests prove this
  host-side suppression. A live model call would not exercise the block gate.
- Public changelog: internal operator policy/evidence only; normal member group
  behavior is unchanged. No changelog entry is needed.

### Verification

All commands ran locally. PostgreSQL tests used only the newly created
`murph_test_linq_group_risk` database. Provider calls in tests were synthetic
HTTP responses; no provider or production credentials were retrieved. The
local capture wrapper supplied the environment below and redacted local paths
before saving ignored logs under `.tmp/linq-risk-*.log`. Commands below are the
underlying commands, with their captured process exit codes.

```sh
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/murph_test_linq_group_risk
export MURPH_PRISMA_SKIP_ENV_FILES=1
```

| Command | Exit/result |
| --- | --- |
| `psql postgresql://postgres:postgres@127.0.0.1:5432/postgres -v ON_ERROR_STOP=1 -c 'CREATE DATABASE murph_test_linq_group_risk'` | 0; new isolated database created |
| `MURPH_PRISMA_SKIP_ENV_FILES=1 pnpm --dir apps/web prisma:generate` | 0; ran before tests |
| `pnpm build:test-runtime:prepared` | 0; focused test dependencies prepared |
| `pnpm --dir apps/web exec prisma migrate deploy` | 0; all migrations, including the additive ledger migration, applied to the new local database |
| `pnpm --dir apps/web exec prisma validate` | 0 |
| `pnpm --dir apps/web typecheck` | 0; final run after test refinements |
| `pnpm --dir apps/web lint` | 0; existing warnings in unrelated files, no errors |
| `pnpm complexity:diff` | Initially 1; split observation/upsert helpers and kept ingress branching in the early-response helper. Final 0; existing webhook maximum remains 92, no added complexity debt |
| `pnpm logs:guard` | 0 |
| `pnpm docs:drift` | 0 before final handoff notes; final rerun pending |
| `git diff --check` | Final standalone capture pending |

Focused test commands and results (the PostgreSQL flag is intentionally absent
from unit-only commands):


`proof-1`: 1; 91 passed, 9 failed. Added the reason-expansion compatibility entry, supplied the encrypted managed-line fixture field, and used the real SDK with synthetic HTTP to preserve provider error payloads and canonical roster shape.

```sh
MURPH_TEST_POSTGRES_CONCURRENCY=1 pnpm --dir apps/web test -- hosted-linq-group-risk-postgres.test.ts hosted-linq-group-leave-attempt-postgres.test.ts production-migration-guard.test.ts --no-file-parallelism
```

`proof-2`: 1; 132 passed, 1 failed. The bound-route fixture needed its canonical thread-container foreign key; added it.

```sh
MURPH_TEST_POSTGRES_CONCURRENCY=1 pnpm --dir apps/web test -- hosted-linq-group-risk-postgres.test.ts hosted-linq-group-leave-attempt-postgres.test.ts hosted-linq-group-risk-webhook-postgres.test.ts hosted-linq-group-leave-webhook.test.ts production-migration-guard.test.ts hosted-retention-owner-split.test.ts --no-file-parallelism
```

`postgres-final`: 0; 53 passed in five files, including existing departure and roster-observation PostgreSQL regressions.

```sh
MURPH_TEST_POSTGRES_CONCURRENCY=1 pnpm --dir apps/web test -- hosted-linq-group-risk-postgres.test.ts hosted-linq-group-leave-attempt-postgres.test.ts hosted-linq-group-risk-webhook-postgres.test.ts hosted-linq-group-leave-postgres.test.ts hosted-onboarding-linq-roster-observation-postgres.test.ts --no-file-parallelism
```

`postgres-refactor`: 0; 22 passed in the three new PostgreSQL files after helper simplification and the 1,200-handle batching assertion.

```sh
MURPH_TEST_POSTGRES_CONCURRENCY=1 pnpm --dir apps/web test -- hosted-linq-group-risk-postgres.test.ts hosted-linq-group-leave-attempt-postgres.test.ts hosted-linq-group-risk-webhook-postgres.test.ts --no-file-parallelism
```

`postgres-handoff`: 0; 14 passed in the two changed PostgreSQL files after strengthening removal-before-rotation and binding-race coverage. Together with unchanged passing suites, the PostgreSQL set contains 54 tests.

```sh
MURPH_TEST_POSTGRES_CONCURRENCY=1 pnpm --dir apps/web test -- hosted-linq-group-risk-postgres.test.ts hosted-linq-group-risk-webhook-postgres.test.ts --no-file-parallelism
```

`unit-1`: 1; 363 passed, 291 failed. Existing planner fixtures did not provide the new ingress delegates. Isolated the two early helpers in those unblocked-planning lanes; the new PostgreSQL lane exercises the real authenticated ingress. Added marker/sighting delegates to departure fixtures.

```sh
pnpm --dir apps/web test -- hosted-ops-linq-handle-block-route.test.ts ops-blocked-numbers.test.ts hosted-retention-cleanup.test.ts hosted-retention-owner-split.test.ts hosted-retention-cron-route.test.ts hosted-linq-group-leave-webhook.test.ts hosted-linq-group-leave-tool.test.ts hosted-ops-linq-group-line-move-route.test.ts hosted-onboarding-linq-dispatch.test.ts hosted-onboarding-linq-thread-route.test.ts hosted-onboarding-webhook-idempotency.test.ts hosted-onboarding-linq-home-route-recovery-service.test.ts hosted-onboarding-linq-read-receipt-authority.test.ts hosted-onboarding-linq-mailbox-root-prewarm.test.ts hosted-onboarding-linq-webhook-auth.test.ts production-migration-guard.test.ts --no-file-parallelism
```

`unit-2`: 1; 490 passed, 3 failed. Added the missing attempt-claim updateMany result to the remaining thread-route departure fixture.

```sh
pnpm --dir apps/web test -- hosted-onboarding-linq-dispatch.test.ts hosted-onboarding-linq-thread-route.test.ts hosted-onboarding-webhook-idempotency.test.ts hosted-onboarding-linq-home-route-recovery-service.test.ts hosted-onboarding-linq-read-receipt-authority.test.ts hosted-onboarding-linq-mailbox-root-prewarm.test.ts hosted-linq-group-leave-tool.test.ts --no-file-parallelism
```

`unit-final`: 1; 921 passed, 3 failed across 19 files. Eighteen files passed, including production-migration-guard, Ops authorization, retention, transport and account-data coverage. Three HTTP expectations lacked the new canonical createdAt field; updated them.

```sh
pnpm --dir apps/web test -- hosted-ops-linq-handle-block-route.test.ts ops-blocked-numbers.test.ts hosted-retention-cleanup.test.ts hosted-retention-owner-split.test.ts hosted-retention-cron-route.test.ts hosted-linq-group-leave-webhook.test.ts hosted-linq-group-leave-tool.test.ts hosted-ops-linq-group-line-move-route.test.ts hosted-onboarding-linq-dispatch.test.ts hosted-onboarding-linq-thread-route.test.ts hosted-onboarding-webhook-idempotency.test.ts hosted-onboarding-linq-home-route-recovery-service.test.ts hosted-onboarding-linq-read-receipt-authority.test.ts hosted-onboarding-linq-mailbox-root-prewarm.test.ts hosted-onboarding-linq-webhook-auth.test.ts production-migration-guard.test.ts hosted-onboarding-linq-http.test.ts hosted-onboarding-linq-transport.test.ts hosted-account-data-service.test.ts --no-file-parallelism
```

`unit-fixes`: 1; 77 passed, 1 failed. All 75 HTTP tests passed. The newly added third UI test exposed the existing happy-dom controlled-input adapter requirement; used the same test-only adapter as ops-member-email-client.test.tsx.

```sh
pnpm --dir apps/web test -- hosted-onboarding-linq-http.test.ts ops-blocked-numbers.test.ts --no-file-parallelism
```

`ui-final`: 0; all three form tests passed: list/unblock/refresh, recoverable list failure, failed pasted-contact mutation followed by retry.

```sh
pnpm --dir apps/web test -- ops-blocked-numbers.test.tsx --no-file-parallelism
```

`unit-http-handoff`: 0; all 75 HTTP tests passed. With the 18 previously passing files and the added UI test, the focused unit set contains 925 tests, all passing after targeted reruns.

```sh
pnpm --dir apps/web test -- hosted-onboarding-linq-http.test.ts --no-file-parallelism
```

Coverage boundaries and handoff:

- Deterministic ingress checks run through authenticated webhook parsing and
  actual local PostgreSQL. They prove blocked received/edit/reaction events
  make zero generation, claim, mailbox, wake, poll or join calls, preserve a
  bound room, and retain marked-room evidence without a roster fetch. Existing
  unblocked planner lanes remain green. No model prompt or provider-visible
  input changed; a live assistant run was not used for this pre-model gate.
- The 1,200-handle observation uses one chat lock, one marker read, one sighting
  upsert and three bulk handle writes, in one database-only transaction.
  Reads and writes are bounded per event; no per-handle datastore loop exists.
  A blocked roster is checked as one batch and departure rechecks binding
  under chat ownership, including a route created after the ingress read.
- Ops route proof covers operator auth, mutation origin, strict input shape,
  server-derived identities, and bounded listing without ciphertext. Client
  proof uses the real component in the DOM harness with synthetic fetches.
  Product UX functional verdict: Ready. Browser rendering, responsive design
  proof and the separate frontend review requested in the brief remain with
  the parent; no screenshot or full authenticated-browser proof is claimed.
- The test-harness workaround is recorded in
  `.agents/friction-log/20261115152545-client-form-tests/friction.md`.
  That entry remains uncommitted under the explicit task boundary and must
  travel with the parent's scoped commit.
- No umbrella acceptance run, CI, ReviewGPT implementation round, commit,
  push, PR, deployment or activation was performed. The parent owns the
  final candidate, frontend review and exact-head CI. This change is eligible
  for final ReviewGPT because it changes schema, ingress policy and retries;
  start it on the intended pushed head concurrently with CI, after known
  frontend edits are complete. The earlier review covered the plan only.

### Parent review changes

- Observation is fail-open. The ledger is evidence, not authority, so a
  ledger-only fault (bad data, constraint, transient error) logs a bounded
  `observation_failed` code and the webhook continues; an aborted request
  still rethrows. Before this, any observer error failed every group webhook.
  The block-roster rejection inside the same transaction is skipped on that
  failure; the sender block, which runs separately, is unaffected.
- (Superseded by the deep review below.) A first version limited the
  observer's roster read to a room's first sighting. That opened an
  enforcement bypass, so the observer's roster read was deleted instead.
- Proof: a case in `hosted-linq-group-risk-webhook-postgres.test.ts` where a
  failed transaction resolves and logs and an aborted one rejects. The three risk
  PostgreSQL files: 24 passed, exit 0. The 19-file unit set: 925 passed,
  exit 0. Web typecheck, lint, `complexity:diff`, `logs:guard`,
  `docs:drift` and `git diff --check`: exit 0.

### Deep review (Codex, read-only) and fixes

| Finding | Outcome |
| --- | --- |
| P1: a sighting could bypass blocked-roster enforcement (first sighting from `participant.added` had no line; a failed first roster read still created a sighting; later messages skipped the check, and admission's own roster read did not check blocks) | Accepted. The parent's "first sighting only" read limit caused it. Fixed by moving the block check into admission's roster (section 2) and deleting the observer's roster read and rejection. Evidence no longer decides whether policy runs. |
| P2: DMs without `chat.is_group` got an extra foreground roster read | Accepted. Gone with the observer's roster read. |
| P2: sender events could discard newer roster metadata | Accepted. Added `roster_observed_at`; roster metadata orders on it. |

Proof after the fixes: a blocked-participant case in the admission cap test
(`hosted-onboarding-linq-thread-route.test.ts`, the same path as the
oversized cases, asserting `group-roster-blocked` and a `blocked_participant`
marker); a roster-ordering case and a current-plus-prior-key block lookup in
`hosted-linq-group-risk-postgres.test.ts`; "no provider read" for the
observer in `hosted-linq-group-risk-webhook-postgres.test.ts`. One existing
mock (`hosted-onboarding-linq-usage-reset-e2e.test.ts`) lacked the block
table that the ingress sender check reads; added. Results, all exit 0: five
PostgreSQL files 57 passed; every non-PostgreSQL test file that imports the
Linq webhook, leave, block or risk modules (39 files) 1,013 passed and 25
opt-in skipped; Web typecheck, lint, `complexity:diff`, `logs:guard`,
`docs:drift`, `git diff --check`.

### Design proof

`/screenshots/ops#ops-blocked-numbers` renders the production `BlockedNumbers`
with synthetic values in four states: before the list opens, a list with more
to load, empty, and a failed load. Two optional initial-state props exist only
for that study; `/ops` passes none. Captured locally through the Playwright
smoke server at 1440px (2x) and 390px (3x): nothing inside the section
extends past the viewport at either width. The page's existing 60px desktop
overflow comes from another study. One change from that review: "Show more"
was a ghost button that read as text; it is now outlined like "Show blocked
numbers".

### Parent deployment and activation

1. Commit the scoped implementation, tests, owner docs, this plan and the Frog
   entry after review. Archive this plan in that candidate commit using the
   repository completion workflow. Leave the other session's member-suspension
   work separate; neither its routing file nor `/ops/usage` was changed here.
2. Apply the additive migration before deploying Web. Old inserts still get
   zero/null attempt state, old marker readers honor the new reason, and old
   code does not use the new tables. No Worker/container protocol changes.
3. Deploy Web, then drain old Web instances before creating the first block.
   Observation is forward-only; do not backfill provider data. The existing
   external retention owner automatically retries eligible legacy markers
   after Web cutover (ten selected per tick; five reserved attempts, at least
   one hour apart; one diagnostic read after exhaustion).
4. After drain, verify the Ops form and operator route, sender suppression,
   blocked-roster rejection for unbound rooms, bound-room preservation,
   observation and bounded retention/attempt progress using the separately
   authorized deployment process. Before first activation, this is not proof
   of production provider removal; queued leave responses remain unconfirmed.
5. Once the first block exists, this Web is the rollback floor. Rolling back
   below it disables blocking and requires an explicit policy decision. For
   future key rotation, rotate dormant blocks and markers while both keys are
   readable, drain old writers, delete prior-key evidence in bounded batches,
   verify no prior-key references remain, then retire the old key.

### Changed files

The implementation handoff contains these paths (including the reviewed plan
that was already untracked when implementation started):

- `.agents/friction-log/20261115152545-client-form-tests/friction.md`
- `ARCHITECTURE.md`
- `agent-docs/exec-plans/active/2026-11-15-linq-group-risk-ledger.md`
- `agent-docs/index.md`
- `apps/web/app/(dashboard)/ops/blocked-numbers.tsx`
- `apps/web/app/(dashboard)/ops/page.tsx`
- `apps/web/app/api/ops/linq-handle-block/route.ts`
- `apps/web/prisma/migrations/20261115190000_linq_group_risk_ledger/migration.sql`
- `apps/web/prisma/schema.prisma`
- `apps/web/scripts/run-prisma-migrate-deploy.ts`
- `apps/web/src/lib/hosted-onboarding/linq-client.ts`
- `apps/web/src/lib/hosted-onboarding/linq-group-risk-webhook.ts`
- `apps/web/src/lib/hosted-onboarding/linq-sender-block.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-service.ts`
- `apps/web/src/lib/hosted-ops/linq-group-line-move.ts`
- `apps/web/src/lib/hosted-ops/linq-handle-block.ts`
- `apps/web/src/lib/hosted-privacy/account-data-service.ts`
- `apps/web/src/lib/hosted-retention/cleanup.ts`
- `apps/web/src/lib/hosted-retention/external-cleanup.ts`
- `apps/web/src/lib/hosted-routing/linq-group-leave.ts`
- `apps/web/src/lib/hosted-routing/linq-group-risk-ledger.ts`
- `apps/web/src/lib/hosted-routing/linq-handle-block.ts`
- `apps/web/test/hosted-linq-group-leave-attempt-postgres.test.ts`
- `apps/web/test/hosted-linq-group-leave-tool.test.ts`
- `apps/web/test/hosted-linq-group-leave-webhook.test.ts`
- `apps/web/test/hosted-linq-group-risk-postgres.test.ts`
- `apps/web/test/hosted-linq-group-risk-webhook-postgres.test.ts`
- `apps/web/test/hosted-onboarding-linq-dispatch.test.ts`
- `apps/web/test/hosted-onboarding-linq-home-route-recovery-service.test.ts`
- `apps/web/test/hosted-onboarding-linq-http.test.ts`
- `apps/web/test/hosted-onboarding-linq-mailbox-root-prewarm.test.ts`
- `apps/web/test/hosted-onboarding-linq-read-receipt-authority.test.ts`
- `apps/web/test/hosted-onboarding-linq-thread-route.test.ts`
- `apps/web/test/hosted-onboarding-webhook-idempotency.test.ts`
- `apps/web/test/hosted-ops-linq-handle-block-route.test.ts`
- `apps/web/test/hosted-retention-cleanup.test.ts`
- `apps/web/test/hosted-retention-owner-split.test.ts`
- `apps/web/test/ops-blocked-numbers.test.tsx`
- `docs/hosted-contact-privacy-rotation.md`
Completed: 2026-11-15
