# Reply latency: deletions on the 1:1 Linq reply path

Status: completed

## Goal

Cut the time from a member's 1:1 Linq message reaching the Web webhook to Codex
`turn/start`, by deleting work. The owner's bar: clean, simple, maintainable
architecture with minimal complexity; add nothing unless a measured bottleneck
or a security requirement demands it.

Fixed constraints from the owner (2026-11-09):

- No added server cost. Standby target 1 and the 10-minute idle window stay.
- 1:1 only. Group paths must not regress but are not being optimised.
- No new cache, queue, feature flag, speculative path or state owner.

## Baseline (7 days, `hosted_ingress_latency_trace`, 1:1 Linq)

| | p50 | p90 | n |
| --- | ---: | ---: | ---: |
| Warm: webhook to `turn/start` | 1.2 s | 4.2 s | 146 |
| Cold: webhook to `turn/start` | 4.1 s | 10.4 s | 88 |

About 40% of turns are cold. The webhook's mailbox transaction is 118 ms p50 /
165 ms p90 and runs 27 round trips (BEGIN, 25 statements, COMMIT). Cold
Cloudflare admission is about 800 ms and is not container start (a standby was
claimed on 171 of 172 cold starts); it is serial Worker/DO to Web to Postgres
owner commands plus Durable Object calls. Snapshot restore is 1068 ms p50 /
2307 ms p90, of which extraction (307 ms p50) starts only after the full
download is authenticated.

## Already decided, not part of this review

- Shipped as separate small PRs: per-member ingress root cache TTL 5 to 30
  minutes (#4759); `gpt-6.1-terra` added to the 12-hour prompt-cache allowlist
  (#4760).
- Rejected with evidence: message payload in the wake; wake before commit;
  two-part restore; snapshot fetch in the Durable Object; Web claiming before
  dispatch; skipping readiness; a stored procedure or one cross-module SQL
  statement for the webhook; a separate "established member" fast-path
  transaction (it would duplicate the planner's policy order and need a
  rollback-and-replan fallback that breaks lock order).
- Withdrawn after a design pass: admitting attachment messages before inbox
  projection (the turn reads evidence that only exists after download,
  normalisation, canonical write and transcription; the gate is the documented
  exception in `docs/contracts/00-invariants.md` 216-219 and came from #2413);
  starting the idle-path reply before the import tail (p50 8 ms; only the
  canonical progress checkpoint costs, about 120-180 ms on roughly a quarter of
  idle turns, and overlapping it would thread a promise across two owners).

## Change A: Web webhook transaction, 27 to 18 round trips

All Web-only, one process, no wire or stored-format change, no deploy skew.
Expected: transaction p50 118 to about 80-90 ms (estimate; measure with the
`hosted-onboarding.webhook.plan-db` log).

Today's in-transaction statements for an established member with an unchanged
home route (`webhook-provider-linq.ts` planner, then
`hosted-mailbox/store.ts` append):

| op | Statement | Verdict |
| --- | --- | --- |
| 1 | participant advisory lock | merge with 2 into one lock-only statement, same order |
| 2 | chat advisory lock | merge with 1 |
| 3 | thread route read | keep (must be its own statement after the lock under READ COMMITTED) |
| 4 | member row `FOR NO KEY UPDATE` | keep |
| 5 | identity row `FOR UPDATE` | keep |
| 6 | identity read | keep |
| 7 | routing read (home chat) | merge 7 + 10 + 13 into one routing read |
| 8 | AI access read | keep |
| 9 | mailbox item dedupe read | keep; becomes the only dedupe read |
| 10 | routing read (revalidate prepared routing) | merge into 7 |
| 11 | group-join outreach read | keep (owner call whether to retire the feature) |
| 12 | daily quota upsert | keep |
| 13 | routing read (pending conflict) | merge into 7 |
| 14 | instant-first-turn fence read | keep |
| 15 | chat advisory lock again (`store.ts` `assertHostedMailboxEnvelopeWorkspaceTargetTx`) | delete: re-entrant no-op, held since op 2 |
| 16 | thread route read again (same function) | delete: see A4 |
| 17 | workspace existence read | keep |
| 18 | root authority advisory lock | keep |
| 19 | active root envelope read | keep |
| 20 | dedupe advisory lock `(user, eventId)` | delete: see A4 |
| 21 | mailbox item dedupe read again | delete: see A4 |
| 22 | causal advisory lock | merge 22 + 23 + 24 |
| 23 | causal sequence upsert | merge |
| 24 | lane sequence upsert | merge |
| 25 | seal locally, `INSERT ... ON CONFLICT DO NOTHING` | keep (`laneSeq` is in the AAD) |

Steps, in order of saving per unit of risk:

- **A1. Pre-transaction reads in series.** Two parallel lookups before the
  transaction open a second pool connection on a cold pool. Run them in series.
- **A2. One routing read** for ops 7, 10, 13. All three keys are unique; one
  owner module. Must keep: a pending claim by another member still forces the
  repair path; two home owners still throws.
- **A3. One statement for the causal lock and both sequence upserts** (22-24).
  The advisory lock must be acquired before either counter is bumped, so the
  statement is ordered lock, then causal upsert, then lane upsert. Risk: a
  counter bumped before the lock would let a game private-evening check-in go
  out stale behind a member message. Postgres test: session A holds the causal
  lock; B's fused statement blocks with counters unchanged as seen by a third
  session.
- **A4. Typed proof instead of ops 15, 16, 20, 21.** The planner already took
  the chat lock and read the route and the dedupe key inside this transaction.
  The chat-lock module gains one function, used by both planner and store, that
  locks the chat and reads its route and returns a branded value holding the
  chat id, the route owner and the transaction object. The planner's dedupe read
  becomes a mailbox-store function that takes that value and, on a miss,
  returns a branded "absent under chat lock" value for `(userId, eventId)`.
  `appendHostedMailboxEnvelopeWithPreparedCryptoTx` accepts the optional proof;
  when its transaction is the same object as the append's and chat, user and
  event match the envelope, the store keeps every local envelope check
  (`threadIsDirect`, authority fields) and skips the second lock, route read,
  dedupe lock and dedupe read. If the insert then conflicts it throws (rollback,
  retryable) rather than committing a duplicate result with a counter bump.
  Without a proof the store behaves exactly as today; Telegram, email, device
  sync, game, meal photo and group callers do not change.
  Why absence at op 3 still holds at op 16: the only `hostedThreadRoute.create`
  site is `thread-container-service.ts` `createHostedThreadRouteRowTx`, and its
  callers take the chat lock first (via
  `demoteHostedMemberLinqGroupChatBindingsTx`); updates do not change owner or
  existence; a delete can only remove a route. Why the dedupe lock is redundant
  here: every appender of a Linq `conversation.message` with this key takes the
  chat lock first, because the store itself does so for every such envelope.
  This is the one step that touches group isolation (a group message must never
  land in a personal workspace).
- **A5. Fuse the participant and chat locks** (ops 1-2) into one lock-only
  statement that keeps participant-then-chat order. Postgres test with
  `pg_locks`: while B waits on the participant lock it does not hold the chat
  lock.
- **A6. Runtime-owner read in one statement** before the direct wake (two
  today).
- **A7 (owner call, not built unless approved). Skip instant-first-turn
  continuation reads for members created more than a fixed window ago.** In 60
  days no real member continued after 24 hours. Adds one constant and one
  branch.
- **A8 (medium risk). Settle this event's own instant reservation inside the
  fence read's transaction** rather than a separate post-commit transaction, on
  the roughly 45% of turns that have one and no generation in flight.

## Change B: Cloudflare admission, delete the `select_target` owner command

Today (`apps/cloudflare/src/runtime-processing.ts` `bindRuntimeTarget`): claim
a standby, then a Worker to Web to Postgres `select_target` command records the
slot name on `hosted_runtime_owner`, then the slot is bound, then readiness and
`prepare_invocation` run, and the slot Durable Object sends `prepare_launch`,
which already carries the same slot name (`runner-container.ts`
`startSupervisedInvocation`, `runnerContainerName: target.slotName`).

Change: delete the `select_target` call. Web's `prepare_launch` sets the target
by compare-and-swap (null or equal) in the transaction that already locks the
owner row. Also delete the dead `if (!ready.preparesSupervisedLaunch)`
mixed-version `prepare_launch` fallback and the duplicate retirement proof for a
stale retained target. Saving: one serial Web/Postgres round trip per cold
start, about 70-140 ms p50, 170-290 ms p90.

What `select_target` protects (`hosted-postgres-runtime.md` 234-235: "Target
selection records the immutable slot before native binding"): Postgres can name,
and so stop, the exact slot if the Worker dies between bind and launch. Without
it, a crash in that window (about 100-200 ms for a standby, 3-4 s for a cold
fallback) leaves a bound slot Postgres does not name. That slot runs no job (a
job needs `prepare_launch` and its receipt) and the slot's own idle cleanup
stops it. Worst case: one idle container for one idle TTL per crash.

Deploy order: Web first (accepts `prepare_launch` with a null target and keeps
accepting `select_target` from old Workers), then the Worker. `select_target`
handling is deleted from Web one release later.

## Change C: unpack the snapshot while it downloads

Today (`apps/cloudflare/src/workspace-snapshot-local.ts`
`restoreEncryptedWorkspaceSnapshotFromEncryptedStream`): the encrypted body is
downloaded and decrypted into a fixed buffer; the AES-GCM tag, both SHA-256
digests and the byte count are verified; only then are `zstd` and `tar` spawned
into a fresh staging directory; the durable root is swapped after extraction.

Change: spawn `tar` and `zstd` into the staging directory before the body loop
and write each decrypted chunk to `zstd` with backpressure. The GCM tag, both
digests and the byte count remain the only gate for swapping the durable root.
On any failure both children are killed and staging removed (that cleanup path
exists). Cap decompressed output at the recorded plain size; rebuild staging on
a body retry. Deletes the full-archive buffer (15-34 MB). Format unchanged, no
deploy skew. Saving estimate: restore p50 1068 to about 849 ms, p90 2307 to
about 1687 ms.

The security question: authenticate-before-extract is a deliberate rule
restated in four earlier plans. This change lets unauthenticated plaintext reach
GNU `tar` and `zstd` (with `--no-same-owner --no-same-permissions`, inside a
staging directory that is discarded unless authentication passes). Exploiting it
needs write access to the R2 object plus useful bit flips through GCM's CTR
stream into compressed data. It still removes a defence layer. The alternative
that keeps the rule (one AEAD tag per segment) needs a new snapshot format and a
two-step rollout, which is more machinery than the saving justifies.

## Questions for the review

1. Is the A4 proof sound for group isolation and for dedupe, and is there a
   simpler way to delete ops 15, 16, 20 and 21 than a branded value passed from
   planner to store?
2. Does fusing lock and counter statements (A3, A5) hold under READ COMMITTED
   and keep lock order?
3. Is dropping `select_target` safe given the crash window, or does some reader
   depend on the target being recorded before bind?
4. Change C: is relaxing authenticate-before-extract acceptable when the swap
   stays gated on full authentication, or should it be dropped?
5. Anything here that should be deleted outright instead of optimised, and any
   step whose saving does not justify its risk.

## Review dispositions

ReviewGPT architecture review, 2026-11-09 (Mountain lane). Its verdict: revise
before building. Each finding below is accepted or rejected with evidence.

| Step | Review verdict | Disposition |
| --- | --- | --- |
| A1 serial pre-reads | Proceed; verify warm latency does not regress | **Accepted.** Build; measure warm and cold-pool turns after deploy. |
| A2 one routing read | Proceed with correction | **Accepted.** One query must fetch every blind-index rotation candidate for the member row, the home-chat keys and the pending-chat keys, with no first-row-wins and no row limit; classify exact member row, distinct home owners and any foreign pending owner separately. Decisions stay at their current points: the canonical duplicate return still precedes routing-preparation mismatch handling. |
| A3 fused causal lock and counters | Proceed conditionally | **Accepted.** Order must be a SQL data dependency (lock result feeds the causal upsert, whose returned row feeds the lane upsert), not sibling CTE order. One store-owned allocator used by both append sites; the standalone causal-lock helper stays for freshness readers. Test corrected: seed both counter rows and prove an observer can take their row locks `NOWAIT` while B is blocked on the causal lock; cover absent counters separately. |
| A4 typed proof | Proceed, narrower | **Accepted.** The proof certifies only: null Linq thread route, this transaction object, this normalised chat id, this member id, this raw inbound event id, dedupe absence read in this transaction. It stays inside the transaction's admission result and append call. A supplied mismatched proof fails before any check is skipped. An insert conflict throws and rolls back the whole transaction. The lock module does not gain a route read (that would reverse the `thread-route-store` to lock-module dependency); the routing owner composes lock and read, and the planner keeps its existing full route read. Built after A1-A3 and A5 land. |
| A5 fused participant and chat locks | Proceed conditionally | **Accepted.** Chat lock acquisition depends on the participant lock's result; the route read stays a separate following statement; existing lock-key construction is reused. |
| A6 one runtime-owner read | Proceed if composed from existing access predicates | **Built, then dropped by the parent.** The runtime owner has no Prisma member relation (owners outlive member deletion), so one statement needed a second, raw-SQL copy of the admission predicate plus a residual second read for thread containers. That owner is the admission hint that lets the Worker skip its claim, so a drifting copy is an access risk. Not worth it for one 3-4 ms read per direct wake. |
| A7 member-age cutoff | Leave out | **Accepted; not built.** A cutoff before exact-event replay lookup can strand a sealed second or third opening reply. |
| A8 settle own reservation in the fence transaction | Defer | **Accepted; not built.** A first-contact retry can claim generation after planning, so "no generation in flight" at the fence does not prove the reservation is ordinary. |
| B delete `select_target` | Keep it | **Accepted; not built.** Execution stays fenced without it, but `retireRuntime` and `stopPostgresRuntimeForUser` address the exact slot through `owner.runnerContainerName`, and slot self-cleanup is not a hard bound when native status or Web reconciliation is unavailable. Removing it would need a new cleanup owner, which the cost constraint rules out. |
| B repeated retained-target retirement | Proceed, via the existing `target_retired` command | **Accepted.** #4761 already removes the second native retire and readback. A follow-up replaces the remaining `retire` plus `release` owner commands on that path with the existing exact-target `target_retired` command (`recordHostedRuntimeTargetRetired`), one owner round trip fewer. |
| B launch-capability fallback | Defer until the rollback floor is established | **Rejected with evidence.** The capability shipped in #3532 on 2026-09-17. `apps/cloudflare/DEPLOY.md` records a later hard rollback floor (#4286, 2026-10-21), so no supported Worker or slot revision predates it. The slot keeps returning the constant for one more release. The PR-level review of #4761 checked base/head deployment compatibility and passed. |
| C extract before authentication | Drop | **Accepted; not built.** It moves the parser trust boundary: the staging directory is not process isolation, and the archive is only known to be the producer's checked archive after authentication. The proposed cap was also wrong: `totalPlainBytes` counts file contents, not the tar stream. The current authenticate, extract, swap order stays. |
| New: delete unused generic mailbox append entrypoints | Proceed | **Accepted.** `appendHostedMailboxItem`, `appendHostedMailboxItemTx` and `appendHostedMailboxItemWithPreparedCryptoTx` have no production caller on `main` (references are the wrappers themselves and tests). Delete them and move the meaningful test coverage onto the envelope entrypoints. No latency effect. |

Build order and outcome: (1) A1, A2, A5 in the planner and routing owner (this
branch; planner transaction 25 to 22 statements); (2) A3 and the
unused-entrypoint deletion in the mailbox store (#4762); (3) A4 in its own PR
after both land; (4) the `target_retired` change, folded into #4761. Measure the webhook
transaction and end-to-end warm and cold distributions after each deploy rather
than subtracting component percentiles.
Updated: 2026-11-09
Completed: 2026-11-09
