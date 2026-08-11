# Database Transaction and Lock Starvation Catalog

Last verified: 2026-08-09
Target catalog base: `7816f428d428a51f3bf3791b4fceef4168d8becf` (`origin/main`)
Target implementation branch: `agent/mailbox-db-critical-section`
Status: point-in-time structural catalog for the exact target base; current
implementation planning must refresh affected paths against the latest `main`
Owner: Web/runtime database reliability

> **Freshness boundary:** Source counts, callsites, classifications, and
> “current-base” wording below describe only the exact target catalog base.
> They are not claims about later revisions of `main`. Re-audit every affected
> owner before using this catalog to plan or approve implementation. The
> critical-section policy and privacy-safe observability constraints remain the
> durable guidance.

## Purpose

This catalog identifies production code and operator scripts that can keep a
PostgreSQL client checked out while waiting on a lock, another database client,
external work, or production-data-dependent work. It is intentionally broader
than one incident or one provider. Its operational goal is to keep every
database critical section short, finite, database-only, and attributable to one
explicit invariant owner.

The target is **not literally zero PostgreSQL locks**. PostgreSQL must take brief
row and index locks to perform correct writes. The enforceable default is:

> Use one atomic `INSERT ... ON CONFLICT`, conditional
> `UPDATE ... RETURNING`, or set-based CTE. When one statement cannot preserve
> the invariant, use a tiny finite database-only transaction. Do not perform
> provider, KMS, model, filesystem, dynamic-import, retry-sleep, second-pool
> checkout, arbitrary-callback, or production-data-dependent loop work while a
> pooled connection is checked out.

Brief internal row/index locks and reviewed bounded cleanup claims remain valid
when their owner, bound, wait behavior, tests, and removal condition are
documented. A timeout or an index alone is not a safety proof.

## Audit boundary and method

The current-base inventory searched the whole repository, then traced the
production call trees rooted in Web application code, shared production
packages, and database-connected operator scripts. An AST pass parsed 1,297
TypeScript/JavaScript files in the PostgreSQL-bearing Web and operator trees;
a repository-wide raw search across the remaining application, package, and
script trees found no additional Prisma transaction or transaction-client
owner. The mechanical pass found:

- 225 Prisma interactive-transaction callsites in 110 production files;
- 433 functions accepting or structurally using `Prisma.TransactionClient` in
  92 production files;
- 83 explicit row/advisory-lock, local timeout, or serializable-transaction
  syntax nodes in 43 production TypeScript/JavaScript files;
- 17 contract-migration SQL bodies executed one at a time by the production
  contract runner;
- six historical Prisma migration files with explicit transaction/lock syntax;
  and
- ten labels-database operator SQL bodies with raw transactions or explicit
  locks, including included SQL fragments executed inside their caller's
  transaction.

The review then followed transaction-client helpers for root-Prisma checkout,
provider/KMS/secure-box work, dynamic imports, generic callbacks, `Promise.all`,
loops, and mailbox or routing composition. Appendix A maps every current
interactive-transaction owner, transaction-client helper file, explicit lock
owner, migration execution owner, and operator SQL transaction body to a
decision row. A source match is retained in that appendix even when it is a safe
non-finding. The normalized source-to-decision union contains 196 production
source paths.

Primitive reconciliation on this base is explicit. Recurring application and
TypeScript operator code contains no `LOCK TABLE` statement; three tracked
historical Prisma migrations contain `LOCK TABLE` and map to `P2-05`. The two
application `FOR NO KEY UPDATE` matches (one with `SKIP LOCKED`) are both in
`hosted-member-routing-linq.ts` and map to `P0-03`; the contract grant-resync
migration has a separate data-dependent `FOR UPDATE` and maps to `P2-05`.
Serializable Prisma transactions occur in the usage-limit notice (`R-04`) and
operator member-usage (`R-15`) owners. Blocking and try-advisory locks, ordinary
`FOR UPDATE`, local `lock_timeout`/`statement_timeout`, raw operator
transactions, and direct migration bodies are represented in Appendix A.

Explicit exclusions are deliberate:

- test, fixture, benchmark, generated, vendored, and release-note sources are
  not production owners;
- historical Prisma migration SQL is not a recurring application owner; files
  with explicit transaction/lock syntax and the runners that can execute them
  are nevertheless cataloged as operator risk;
- SQLite transactions, filesystem/resource locks, and in-process mutexes do not
  check out a PostgreSQL client and are outside this catalog; a call tree that
  reaches PostgreSQL from one of them re-enters scope at that database owner;
- implicit single-statement ORM transactions and PostgreSQL's ordinary internal
  row/index locks are covered by the default policy rather than enumerated as
  JavaScript transaction owners;
- packages without a database client are covered at the Web owner they invoke;
- completed DDL, database triggers/functions, and dynamically constructed SQL
  still require live statement and blocking evidence because source search
  cannot prove their absence at runtime.

This is structural evidence, not a claim that each family caused a particular
rejected request.

## Incident and capacity interpretation

Production observed a PgBouncer client-admission rejection with SQLSTATE
`08P01` and the specific `max_client_conn` message. A classifier that recognizes
only SQLSTATE `53300` misses that condition; the current-base classifier matches
the specific message and must not classify every `08P01` as exhaustion.

That observation proves client admission exhaustion. It does **not** identify
which static transaction family caused each rejected request. P0/P1 ratings are
structural amplification hypotheses until correlated with aggregate pool wait,
transaction age, and blocker graphs.

Current source defaults are useful only as code configuration, not live
capacity evidence. The primary Web client defaults to a pool maximum of 15, a
5-second checkout timeout, a 10-second interactive-transaction acquisition
wait, a 15-second default interactive-transaction timeout, and a 5-second slow
transaction threshold (`apps/web/src/lib/prisma.ts:15-22`). The isolated
runtime-log pool defaults to 5 and caps configuration at 10
(`apps/web/src/lib/hosted-runtime-log/database.ts:8-10`). Historical database or
PgBouncer ceilings from plans are not current evidence.

Before changing capacity, re-read the live values for PostgreSQL connection and
reserved-slot limits; PgBouncer mode, pools, reserve pool, and client limit;
every process pool maximum; live process counts; migration/operator demand;
pool-wait percentiles; transaction ages; and blocking graphs. Increasing
capacity can provide headroom, but it does not repair connection-held waiting.

## Risk scale

| Class | Decision rule |
| --- | --- |
| **P0** | Shared or burstable foreground owner that holds a client/lock across external work, another pool checkout, an arbitrary callback, an unbounded loop, or a global sweep. Capable of starving unrelated work. |
| **P1** | Important or high-volume owner with bounded-but-material external/crypto work, multiple authority locks, a broad callback, or a global cleanup statement without a hard row/wait bound. |
| **P2** | Lower-frequency or DB-only owner whose lock/transaction is broader than the invariant, whose cleanup shape lacks contention hardening, or whose foreground cleanup is avoidable. |
| **retain** | Current safe/non-finding shape: one atomic statement or a tiny reviewed database-only commit with explicit bounds. “Retain” is not an automatic allowlist entry. |

## Current-base reconciliation corrections

The historical structural source seeded searches but does not override current
code. The exact snapshot changes six material conclusions:

1. **Phone analyzed-result P0 is closed on this base.** Result encryption occurs
   before the conditional result write, durable result state precedes
   notification work, and the notification mailbox append is a separate short
   transaction after mailbox-root prewarm
   (`apps/web/src/lib/phone-calls/result.ts:240-376`). The phone owner remains a
   mailbox dependency and the smaller call-ended/read-update shapes remain
   simplification candidates, but the historical roughly 50-second combined
   crypto/state/mailbox transaction is absent.
2. **Auto-trial loser cleanup is split correctly on this base.** It retrieves
   candidate Stripe subscriptions before the member lock, performs only DB
   revalidation under the configured 120-second lock budget, and cancels after
   the transaction (`apps/web/src/lib/hosted-onboarding/pulse-trial-subscription-cleanup.ts:180-264`). The stale
   nearby comment must not be treated as implementation truth. Auto-trial still
   remains P0 because separate 30-second provisioning/finalization paths create,
   retrieve, and cancel Stripe state while the member row is locked.
3. **The sensitive-action challenge sweep is live, not dormant.** The production
   settings route calls `createSensitiveActionChallenge`, whose transaction
   performs a global expired-row delete before insert
   (`apps/web/app/api/settings/sensitive-action-challenge/route.ts:43-49`;
   `apps/web/src/lib/sensitive-actions/server.ts:33-68`). It is P1 until cleanup
   is separately bounded.
4. **Retention cleanup is bounded but not unqualified allowlist material.** It
   caps work at four batches of 5,000, but mailbox claims use `FOR UPDATE`
   without `SKIP LOCKED` or fail-fast contention behavior on this base
   (`apps/web/src/lib/hosted-retention/cleanup.ts:286,417`). It is P2 retain-with-gap.
5. **Linq thread-route planning contains a live provider-under-lock edge.** The
   existing-route webhook path can hold participant/member authority in the
   planning transaction, call `getHostedLinqChatHandles` with a 1.5-second
   provider timeout, loop over the returned roster, and then mutate participant
   access (`apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts:2260-2345,3714-3810`).
   This belongs to the thread-routing P0, not the retained provider-event row.
6. **Usage-credit reconciliation and binding split at preparation.** Checkout
   creation/session binding, saved-card binding, and one purchase-status path
   still encrypt or decrypt Stripe references after payer/beneficiary locks and
   remain `P1-05`. Incoming Stripe reconciliation prepares provider reads and
   ciphertext before its transaction; its current database-only, hard-bounded
   reconciliation maps to `R-14` rather than inheriting the binding P1.

PR `#1479` is only a tracked/in-flight structural replacement for internal
request nonce admission and remains pending security remediation. This snapshot
does not prove that its changes are present.

## P0 catalog: shared starvation amplifiers

| ID | Owner and current callsites | Lock or transaction shape | External or data-dependent reachability | Capacity domain | Class | Replacement or decision rationale | Planned PR owner |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `P0-01` | Core mailbox append in `hosted-mailbox/store.ts`; shared callers include action approvals, email ingress, assistant asks, activation, sponsorship notifications, device and clinical wake, onboarding and preference updates, group-join confirmations, Linq/Telegram message and reaction ingress, environment voice, meal-photo handoff, phone result notification, runtime signaling, newsletter, Codex auth, and referral notices. | Dedupe advisory lock, per-user causal-sequence advisory lock, optional source-message lock loop, counter allocation, encrypted payload preparation, item/sidecar writes, and uniqueness handling in one interactive transaction (`apps/web/src/lib/hosted-mailbox/store.ts:299-438,2110-2142`). | Secure-box sealing dynamically imports domain-root code and may unwrap through KMS while the transaction client and advisory locks are held. Source-message lock count follows caller input. | Primary shared Web pool. | **P0** | Unique `(user_id,dedupe_key)` plus `INSERT ... ON CONFLICT` owns dedupe; prewarm/unseal the domain root before checkout; pass a local prepared crypto context into a fixed-statement sequence/insert commit; preserve contiguous sequence semantics explicitly. Mailbox must land before activation or higher-level callers claim mailbox safety. | `agent/mailbox-db-critical-section` |
| `P0-02` | Device admission, connection mutation, credentials, dirty supersession, wake persistence, companion ingestion, scheduled/recovery callers in `device-sync/prisma-store*` and `wake-service.ts`. | Member row plus connection advisory locks; `withConnectionMutationLock` and `withHealthDataAdmissionLock` invoke caller-supplied callbacks; connection writes and dirty-state transitions compose nested owners. | Credential seals run under member/connection locks. Dirty supersession reads a production-sized payload collection, decrypts/classifies it, and dynamically imports Junction classification under a row lock. Wake callbacks can append mailbox work. | Primary shared Web pool; burstable webhook, companion, OAuth, scheduled, and recovery ingress. | **P0** | Replace callbacks with narrow consent/epoch/idempotency claims; encrypt before commit; persist credential-independence at admission; use revision CAS and set-based bounded deletion; apply the same contention behavior to every caller. Meal-photo credentials remain `P1-04`. | `agent/device-sync-db-critical-section` |
| `P0-03` | Thread-container route create/refresh, Linq chat ownership, home routing, recovery, engagement authority, member routing, prepared thread containers, and existing-route Linq webhook planning. | Member/chat/route advisory and row locks span route reads, membership changes, root provisioning, encrypted pending context, demotion/refresh, participant access, and activation mailbox append. | Secure-box open/seal, legacy root provisioning, routing mutation, mailbox activation, and a live Linq roster provider read are reachable after earlier locks. The roster branch loops over provider-returned handles while the transaction remains open. Pending group setup is a dependent P1 owner. | Primary shared Web pool; public Linq/group ingress and recovery. | **P0** | Unique external-thread identity plus revision CAS owns route authority; prepare IDs/roots/ciphertext before commit; move activation to durable outbox/post-commit mailbox; remove advisory locks only after constraints cover rotating lookup keys. | `agent/thread-routing-db-critical-section` |
| `P0-04` | Usage-credit settlement, grant consumption, usage recording/allowance callbacks, signup/referral reward settlement, grant/reversal helpers. | Beneficiary and grant locks followed by ordered grant reads, per-grant projection updates, beneficiary projection/version updates, ledger writes, and caller callbacks. | Grant iteration is controlled by production ledger fragmentation; statement count scales with grants. Related mailbox notices inherit `P0-01`. | Primary shared Web pool; ordinary model usage and funding products. | **P0** | Use a bounded set-based CTE or one spendable balance row with immutable evidence ledger; bulk ledger insert; deterministic settlement identity; enforce a hard grant cap until replacement. Checkout/Stripe binding remains separate `P1-05`. | `agent/usage-credit-db-critical-section` |
| `P0-05` | Proactive group-join outreach drain, participant/offer locks, provider fence, and group-aware signup side effects in `group-join-outreach-*`, `join-offer-reaction.ts`, and `webhook-transport.ts`. | Global drain advisory, participant advisory, member/sponsorship locks, `FOR UPDATE SKIP LOCKED` claim, routing/line selection, and provider-dispatch fence in one transaction. | Linq chat creation is awaited under the locks; line/candidate selection loops follow live rows. The group-aware signup fence also performs the provider request under member authority. | Primary shared Web pool; cron and webhook foreground composition. | **P0** | Claim a stable effect with DB-only CAS/`SKIP LOCKED`, commit provider idempotency identity, call Linq post-commit, finalize/reconcile unknown outcomes. Group outreach must land before participant-lock removal and before account-deletion lock removal. | `agent/group-join-outreach-db-critical-section` |
| `P0-06` | Hosted identity/authentication, Privy reconciliation, participant/member/referrer locks, reply-alias and domain-root bridges, phone-transfer retirement. | Contact/participant/member/referrer locks compose identity reads/writes, reply aliases, activation, root provisioning, and routing reconciliation. | Live Privy reads and control-domain KMS/secure-box work are reachable under transaction authority; legacy root bridges can prepare KMS candidates after checkout. | Primary shared Web pool; signup/auth foreground path. | **P0** | Unique contact claims and deterministic member resolution; perform Privy and crypto preparation before commit; make one reconciliation CAS; remove legacy root-in-transaction bridges after callers migrate. | `agent/hosted-identity-auth-db-critical-section` |
| `P0-07` | Generic member-row Stripe mutation wrapper and provider-under-lock callers: trial extension, auto-trial, start-paid/resume, plan switching, Family capacity/member transitions, Family-sponsored cleanup, and customer creation. | `withHostedMemberStripeMutationLock` accepts an arbitrary callback under a member `FOR UPDATE` with a 780,000 ms transaction timeout; ops variant may clear `lock_timeout`. | Confirmed Stripe create/retrieve/update/cancel work is reachable under lock. Auto-trial has 30-second provider-under-lock provisioning/finalization, including authoritative retrieval and cancellation. The current 120-second loser-cleanup implementation does only DB revalidation under lock; retrieval/cancellation are outside. | Primary shared Web pool; billing bursts can block unrelated member work. | **P0** | Replace generic wrapper with stable claim/provider/finalize state machines and provider idempotency; prepare provider/crypto inputs before commit; reconcile unknown outcomes. Keep DB-only/prepared callers distinct from provider-under-lock callers. | `agent/billing-stripe-critical-section` |
| `P0-08` | Isolated runtime-log recording in `hosted-runtime-log/store.ts`. | Runtime-log DB transaction takes a subject advisory lock, then awaits primary-DB `isUserActive`, then inserts logs. | A primary stall or checkout wait occurs while one isolated client and advisory lock are held. | **Separate isolated runtime-log pool**, 5 default/10 maximum; primary lookup uses the primary pool. | **P0** | Read a monotonic primary tombstone/activation fact before the isolated transaction or replicate the needed authority; commit logs with one isolated statement. Runtime-log tombstone must precede account-deletion simplification. | `agent/runtime-log-cross-db-critical-section` |
| `P0-09` | Device browser-assertion nonce admission. | Foreground transaction globally deletes every expired nonce and then inserts the unique nonce. | Delete cardinality and lock wait depend on production backlog; expiry index does not bound either. | Primary shared Web pool; device foreground admission. | **P0** | Make unique insert the replay authority; move cleanup to a bounded background `SKIP LOCKED` claim with explicit rows/wait/yield behavior. | `agent/device-sync-db-critical-section` |
| `P0-10` | Internal request nonce admission in `hosted-execution/internal-request-nonces.ts`. | Foreground transaction globally deletes every expired nonce and inserts the unique nonce. | Delete cardinality and lock wait depend on production backlog. | Primary shared Web pool; internal foreground admission. | **P0** | Unique insert only; bounded asynchronous cleanup. PR `#1479` is tracked/in-flight pending security remediation and is not treated as present here. | PR `#1479` / owner to be confirmed after remediation |

### Closed historical P0: phone analyzed-result finalization

`R-05` records the current phone-call shapes. The historical combined
approximately 50-second crypto/state/mailbox transaction is not present on this
base. Do not reopen `agent/phone-call-db-critical-section` absent new call-path
proof; phone notification still depends on the mailbox P0.

## P1 catalog: material bounded or multi-owner critical sections

| ID | Owner and current callsites | Lock or transaction shape | External or data-dependent reachability | Capacity domain | Class | Replacement or decision rationale | Planned PR owner |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `P1-01` | Member activation, initial onboarding, channel sync, invite activation, email/Telegram sync. | Member/identity activation writes, root provisioning/prewarm, activation mailbox work, and channel events in one transaction. | Root provisioning and control/ingress KMS prewarm are reachable after checkout; prepared mailbox append remains an ordering dependency. | Primary shared Web pool. | **P1** | Prepare all roots before checkout; one activation CAS plus stable outbox; land mailbox first. | `agent/member-activation-crypto-db-critical-section` |
| `P1-02` | Vault-share grant/projection stores. | Grantor/destination active-authority row locks followed by projection rebuild and revision update. | Secure-box projection encryption occurs after authority locks. | Primary shared Web pool. | **P1** | Prepare ciphertext before commit; make projection revision the CAS owner; bound changed rows. | `agent/vault-share-db-critical-section` |
| `P1-03` | Clinical connect intents, OAuth sessions, connection persistence, disconnect, retrieval control. | Per-member advisory/row state plus global expiry sweeps; connection/run/wake transaction performs three sequential secure-box seals. Expired claim/session branches delete and then throw from the callback, rolling the delete back. | Three secure-box/KMS seals and mailbox wake are reachable in persistence; global sweep cardinality is production-dependent. Provider discovery/fetch is otherwise outside. | Primary shared Web pool. | **P1** | Separate bounded expiry cleanup; conditional claim updates; seal all fields before commit; one connection/run CAS and stable wake. Rolled-back delete branches should become read-only conflict returns. | `agent/clinical-oauth-db-critical-section` |
| `P1-04` | Meal-photo enrollment, scoped activation/revocation, companion photo handoff. | Member and sponsorship locks protect reusable-secret open or new-secret seal and enrollment revision checks. Photo handoff composes mailbox append. | Secure-box open/seal under member lock; mailbox dependency after capture. | Primary shared Web pool; foreground companion setup/capture. | **P1** | Prepare secret material before commit; make `authorityRevision` the conditional-update owner; mailbox work follows `P0-01`. | `agent/meal-photo-credential-db-critical-section` |
| `P1-05` | Usage-credit checkout creation/session binding, saved-card PaymentIntent/charge binding, and purchase-status expiry inspection. | Payer/beneficiary locks and purchase state transitions surround Stripe-reference encrypt/decrypt work. | Secure-box/KMS encrypt or decrypt remains reachable after locks in these dedicated callers. Incoming Stripe reconciliation and account-deletion session persistence prepare provider/crypto evidence before their reviewed commits and map to `R-14`/`P2-01` instead. | Primary shared Web pool. | **P1** | Prepare encrypted bindings and any required plaintext comparison before commit; use stable purchase/effect identity and conditional transition; keep settlement (`P0-04`) separate. | `agent/usage-credit-stripe-binding-db-critical-section` |
| `P1-06` | Assistant ask/current-sender admission, runtime-access owner/member/thread locks, sponsorship authorization/refill/notification, disclosure/sponsorship stores. | Request advisory or member/access locks precede source mailbox-state reads/decrypt and mailbox append. | Mailbox encryption/KMS is inherited from `P0-01`; authority reads and source-state decrypt occur under request/member locks. | Primary shared Web pool. | **P1** | Deterministic request/effect identity, authority in `INSERT ... SELECT`, post-commit mailbox/outbox. This row owns the higher-level state only; mailbox owns the shared append risk. | `agent/thread-routing-db-critical-section` after `agent/mailbox-db-critical-section` |
| `P1-07` | Pending group setup and prepared thread-container participant access. | Member/group/thread rows are locked while pending setup is read, decrypted, canceled/armed, and route authority is checked. | Secure-box open under locks; route dependency inherited from `P0-03`. | Primary shared Web pool. | **P1** | Encrypt/decrypt before critical commit where authority permits; use setup revision CAS; thread-routing branch owns the shared route primitive. | `agent/thread-routing-db-critical-section` |
| `P1-08` | Linq inventory application, configured-line sync, operator rehome. | Global inventory advisory followed by a data-dependent loop (currently capped by provider page/sync limits) of per-phone advisory locks and multiple writes. | Provider listing occurs before apply, but statement count under the global lock follows provider inventory. Operator-only execution does not make the shape safe. | Primary Web database; operator/migration demand shares server and PgBouncer capacity even when process pools differ. | **P1** | Bulk upsert one versioned provider snapshot; make line identity/epoch the authority; hard cap rows/statements and yield on contention. | `agent/linq-inventory-db-critical-section` |
| `P1-09` | Connected-app intent creation. | Foreground transaction asserts active member, globally deletes expired intents, and inserts a new intent. | Sweep cardinality and wait depend on production backlog; provider calls are outside. | Primary shared Web pool. | **P1** | Insert only; bounded asynchronous expiry claim. | Unassigned: connected-app expiry owner required |
| `P1-10` | Direct device OAuth/session admission. | Foreground global expired-session delete and read-before-write consume/rotate transitions. | Sweep cardinality is production-dependent; expiry index is not a bound. | Primary shared Web pool. | **P1** | Insert/CAS only; bounded background cleanup; keep provider work outside. | `agent/device-sync-db-critical-section` |
| `P1-11` | Sensitive-action challenge creation. | Live settings route invokes a transaction that globally deletes expired challenges then inserts one. | Sweep cardinality and wait depend on production backlog. | Primary shared Web pool; foreground sensitive settings action. | **P1** | Stable challenge insert plus bounded asynchronous cleanup. This is live on the audited base, not dormant. | Unassigned: sensitive-action expiry owner required |
| `P1-12` | Group offer affirmation callbacks and repeatable-read group projections in `group-offer-affirmation.ts` and `group-store.ts`. | Transaction helper invokes caller-supplied `assertActorStillBound`/`onAcceptedTx`; group projections iterate live members/shares under repeatable-read snapshots. | Callback duration is not owned by the helper; projection loops follow group/share size. Current callbacks appear database-only, which is evidence for scope, not a blanket exemption. | Primary shared Web pool. | **P1** | Replace callback API with named bounded transitions; cap/read projections outside lock-bearing commits; document hard group/share bounds where snapshot reads remain. | Unassigned: group-state critical-section owner required |
| `P1-13` | Linq delivery/onboarding/webhook transaction wrappers and delivery state owners. | Generic wrappers select root transaction versus transaction client and invoke callbacks; some call trees also take chat/route locks before DB transitions. | Named delivery sends are generally outside their commit, but generic callback ownership permits regression. Mailbox append maps to `P0-01`; route crypto and the live roster provider read map to `P0-03`. | Primary shared Web pool; high-volume ingress/egress. | **P1** | Replace generic wrappers with named claim/finalize statements; enforce static no-provider/no-root-client checks in transaction call trees. | `agent/thread-routing-db-critical-section` or `agent/group-join-outreach-db-critical-section` by effect owner |
| `P1-14` | Labels-database bulk imports and repairs under `apps/web/sql/foods`, `apps/web/sql/product-tests`, and `apps/web/sql/supplements`, invoked through the secret-safe `psql` wrappers. | Raw `BEGIN`/`COMMIT`; several blocking global advisory transaction locks; local `\copy`, temporary tables, validation, and bulk insert/update/delete remain in one transaction. | Input-file and live-table row counts control duration and lock footprint; `psql` reads local input while the database transaction is open. There is no provider/KMS call, but the filesystem and data-dependent work violate the default. | Configured labels PostgreSQL database through a direct operator client. It is separate from the primary Web and runtime-log pools; whether it shares a PostgreSQL server is live topology, not a source assumption. | **P1** | Stage and validate immutable input before checkout; apply a revision-owned set-based commit or hard-bounded chunks; use fail-fast admission only when optional; record exact rows/statements/waits and rollback/replay behavior. | `agent/migration-lock-guard` for admission/bounds; labels-data owner for transaction refactor |

## P2 catalog: broad or avoidable lower-frequency work

| ID | Owner and current callsites | Lock or transaction shape | External or data-dependent reachability | Capacity domain | Class | Replacement or decision rationale | Planned PR owner |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `P2-01` | Account deletion/suspension and `account-deletion-cleanup.ts`. | Short suspension fence is followed later by a terminal DB transaction with data-dependent member/container/computer/webhook-owner lock loops and roughly seventy sequential delete/helper awaits. It can acquire the global outreach lock after earlier locks. | Provider revocation/cancellation is outside the terminal transaction on this base; mailbox/identity helper composition and DB work remain broad. The webhook advisory namespace has no matching non-test writer on this base and must be revalidated before removal. | Primary shared Web pool; low-frequency privacy path. | **P2** | Preserve privacy atomicity: use a short terminal fence plus bounded idempotent cleanup only if repository contracts permit; otherwise deterministic set-based database-only deletion. Group outreach and runtime-log tombstone must land first. | `agent/account-deletion-db-critical-section` |
| `P2-02` | Device connect-intent creation/reconnect link. | Foreground transaction globally deletes expired intents before create; claim uses read/delete/update/reread. | Sweep cardinality is production-dependent. | Primary shared Web pool. | **P2** | Insert only with separate bounded cleanup; conditional `UPDATE ... RETURNING` for claim. | `agent/device-sync-db-critical-section` |
| `P2-03` | Companion HRV receipt inspection/claim cleanup. | Foreground inspection deletes expired receipts; claim path repeats expiry deletion while the dirty-connection row is locked and then processes bounded resource input. | Redundant cleanup extends the surrounding dirty-connection critical section; row count can grow with expired backlog. | Primary shared Web pool. | **P2** | Remove foreground cleanup; use one bounded background expiry claim; keep receipt identity/CAS in the admission statement. | `agent/device-sync-db-critical-section` |
| `P2-04` | Hosted retention cleanup. | At most four database-only batches of 5,000; mailbox claims use `FOR UPDATE` without `SKIP LOCKED` or fail-fast behavior. | No external work, but a blocked mailbox claim can consume the cleanup client and contend with foreground owners. | Primary database; background/maintenance process unless deployment proves isolation. | **P2 retain-with-gap** | Add `SKIP LOCKED` or a reviewed fail-fast claim and explicit lock wait; keep 4 × 5,000 hard bound. Not an unqualified allowlist item today. | Owner follow-up required; no removal PR |
| `P2-05` | Primary-database migration execution in `run-prisma-migrate-deploy.ts` and `run-production-contract-migrations.ts`; all 17 contract-migration bodies; and six historical Prisma migrations with explicit transaction/lock syntax. | Direct migration transactions execute DDL or data-dependent backfill/validation statements; explicit shapes include `LOCK TABLE`, `FOR UPDATE`, and local lock timeouts. Contract migration admission itself is the safe `R-01` try-lock primitive. | No provider/KMS/model work, but row/table scope and total transaction duration depend on database contents and the migration body. Even a one-statement body can wait on application locks. | Direct primary-database operator connection bypasses the Web pool/PgBouncer runtime path but shares PostgreSQL slots, locks, WAL, and server capacity with the application. | **P2 retain-history / per-migration guard** | Do not rewrite applied migrations. Future migrations require direct admission, fail-fast lock/statement bounds, exact object/statement/row review, blocker observability, and a rollout window; a safe admission lock does not blanket-allow any body. | `agent/migration-lock-guard` for future admission/bounds only |

## Safe and non-finding reconciliation

The following current-base shapes are retained or simplified without deleting
correct atomicity. “Retain candidate” means no P0/P1 removal PR is justified by
present proof; it is not an allowlist entry. Unless a row overrides them, source
defaults are a 10-second interactive-transaction acquisition wait and a
15-second total callback timeout; the absence of a numeric lock-wait or exact
statement bound remains an evidence gap rather than permission.

| ID | Current owner/shape | Current-base decision | External/root-client boundary | Hard bound and wait | Capacity/contention behavior | Tests and review/removal condition | Classification / PR |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `R-01` | Production contract-migration admission lock; runtime-log pooled/direct topology proof. | Contract admission uses one fail-fast `pg_try_advisory_xact_lock`, a 5-second local lock timeout, and a 30-second statement timeout before exactly one migration file is evaluated. The topology proof uses two clients, one random-key lock pair, a second-client try-lock, and unconditional rollback; the role must enforce a positive statement timeout no greater than 10 seconds. | No provider/KMS/model/filesystem work occurs in the retained lock/probe primitives. Migration bodies are separate reviewed SQL and are not blanket-allowlisted; the broad grant resync maps to `P2-05`. | Admission/probe result cardinality is one row and the lock key count is one. Migration-body statement/row bounds are artifact-specific and therefore outside this retained primitive. | Direct operator/deploy clients; admission fails immediately on a held lock. The topology key is random and the contending probe is non-blocking. | Keep focused runner/topology failure tests. Re-review on runner statement changes, timeout changes, execution-lane changes, or server-budget changes. | **retain primitive only**; `agent/migration-lock-guard` for future admission/bounds. |
| `R-02` | Product feedback. | One member advisory lock protects a fixed DB-only feedback/daily-cap write; digest email occurs after commit. | No external/root-client work under lock. | Fixed statements and one member/day scope; default 15-second transaction ceiling. | Primary pool; contention serializes one member only. | Tests must keep email after commit and same-day dedupe. Replace only if unique daily identity fully owns the invariant. | **retain candidate**; no removal PR. |
| `R-03` | Linq first-contact and participant-contact claims. | Small DB-only contact claim; OpenAI classification happens after the claim. Participant contact lock helper remains generic and should not spread. | No model/provider work under the reviewed first-contact claim. | History/attempt reads are hard-bounded by product caps; default 15-second transaction ceiling. | Primary pool; per-contact contention. | Tests must gate attempt cap and prove classifier starts after commit. Remove advisory helper when unique contact/event identity covers every caller. | **retain candidate**; no removal PR absent new proof. |
| `R-04` | Usage-limit notice claim. | Serializable DB-only claim with member/period rows; provider delivery is after commit. | No provider/KMS/root-client work under claim. | Fixed keyed rows/statements; default 15-second transaction ceiling. | Primary pool; same member/period serializes, unrelated keys proceed. | Concurrency test for one notice and post-commit delivery. Replace with `INSERT ... SELECT ... ON CONFLICT` when equivalent. | **retain candidate**; no removal PR. |
| `R-05` | Phone call-ended/result CAS, notification, reservation, and usage. | Analyzed result encrypts before CAS and notifies after durable state. Call-ended/read-update and usage commits are small DB-only shapes. Notification has a separate mailbox transaction after root prewarm. | No phone-result KMS or provider call in the result-state commit; mailbox inherits `P0-01`. | One call row per CAS; reservation has a fixed keyed set; default transaction ceilings. | Primary pool; keyed by call/member. | Same-call replay, stale CAS, deleted-call race, and mailbox retry tests. Reopen dedicated phone branch only if external work re-enters the state commit. | **retain candidate**; no dedicated removal PR. |
| `R-06` | Runtime-latency transitions. | Per-trace `FOR UPDATE` plus fixed merge/update; sequential batch behavior avoids pool fanout. | No provider/KMS/root-client work in reviewed callbacks. | One trace row and fixed statements per transition; default transaction ceiling. | Primary pool; telemetry must yield/drop rather than degrade product work. | Keep merge/CAS tests and add a contention-drop policy if waits become material. | **retain candidate**; no removal PR. |
| `R-07` | Device agent-session transitions, webhook-trace claim/store, webhook trace lock helper. | Narrow keyed update/reread or create/CAS; trace-owner try-lock exists. | No external work in reviewed store methods. | One session/trace owner and fixed statements; default transaction ceiling. | Primary pool; keyed contention. | Same-key claim/replay tests. Account-deletion webhook namespace has no live writer proof; revalidate before deleting the helper. | **retain candidate**; no removal PR. |
| `R-08` | Clinical retrieval reservation, page completion/release, connection reauth/disconnect. | Conditional updates across one request/run/connection set; provider fetches are outside. | No provider work in reviewed reservation/finalization callbacks. | Fixed rows/statements per page transition; default transaction ceiling. | Primary pool; keyed by run/request. | Page replay, stale run, and reauth CAS tests. Mailbox notification remains separately owned. | **retain candidate**; no removal PR. |
| `R-09` | Workspace checkpoint/browser-vault replica authority. | DB-only workspace row claims, fixed counter/checkpoint updates, and bounded mailbox acknowledgements under current protocol. | No provider/KMS/root-client work in the reviewed transaction functions. | Protocol-bounded rows/statements; explicit acknowledgement bound must remain tested; default transaction ceiling. | Primary pool; per workspace/member. | Checkpoint contiguity, stale version, and unrelated-workspace concurrency tests. Re-review if acknowledgement bound changes. | **retain candidate**; no removal PR. |
| `R-10` | Computer-use state transitions. | Member/run/handoff row locks protect fixed state-machine transitions; helper parameters named `prisma` receive the transaction client in lock-held call paths. | Provider/browser work is outside the reviewed commits; no second checkout proved in current call tree. | Fixed keyed rows/statements per transition; default transaction ceiling. | Primary pool; per member/run. | State transition, stale claim, cleanup, and two-member concurrency tests. Remove broad member mutex only with equivalent unique/CAS invariant. | **retain candidate**; no removal PR. |
| `R-11` | Legal consent grant/revoke/decline. | Member row serializes a fixed consent event/grant update; no health provider call under lock. | External work outside. | Fixed scope/event rows; default transaction ceiling. | Primary pool; per member. | Consent epoch/admission race tests. Consider narrower consent epoch, but do not remove atomicity first. | **retain candidate**; no removal PR. |
| `R-12` | Hosted inference connection replacement. | Encryption is prepared before a member/revision replacement commit. | No KMS/provider work under transaction. | One member/connection revision and fixed statements; default ceiling. | Primary pool; per member. | Revision conflict and prepared-ciphertext tests. | **retain candidate**; no removal PR. |
| `R-13` | Physical-note reserve/finalize/fail. | Lob/provider work is outside; keyed member/note/usage state is committed in fixed transitions. | No provider call under reviewed transactions. | Fixed rows/statements per reservation/finalization; default ceiling. | Primary pool; per member/note. | Reservation replay, finalization CAS, and provider-delay assertion. | **retain candidate**; no removal PR. |
| `R-14` | Billing reservation/finalization, prepared billing success, incoming Stripe event and usage-credit reconciliation callsites whose provider/crypto preparation is outside the member lock. | Stable event/checkout/purchase states with DB revalidation. This row excludes provider-under-lock callers in `P0-07` and checkout/saved-card crypto-under-lock callers in `P1-05`. | Provider/crypto evidence is prepared before these specific callbacks. Current pulse-trial loser cleanup retrieves before and cancels after its DB-only lock. | Fixed keyed billing rows. Usage-credit financial reconciliation is hard-bounded to one refund and at most 100 disputes, applied in two passes; it still needs an exact statement/wait record before allowlist admission. | Primary pool; keyed by event/member/purchase. | Provider-gated tests must assert no transaction remains open during retrieval/cancellation, and the 100-item source bound must remain enforced. Reclassify immediately if provider/crypto preparation re-enters the callback or the loop bound widens. | **retain candidate**; no removal PR. |
| `R-15` | App-review member and member-usage operator tools. | DB-only administrative transitions; no public ingress. | No provider work in reviewed callbacks. | Fixed target member/period rows; command-specific transaction ceiling. | Operator process still shares server/PgBouncer capacity. | Dry-run/focused operator tests and explicit concurrency guard. Re-review if widened to bulk input. | **retain candidate**; no removal PR. |
| `R-16` | Group join accept/leave/confirmation/tool transitions and newsletter read snapshot not covered by `P1-12`. | Keyed DB-only group/member transitions; provider effects occur after commit. | The DB-only membership/tool portions have no provider/KMS work; confirmation mailbox append maps separately to `P0-01`. | Fixed participant/group transition rows; newsletter snapshot size is product-bounded and read-only. | Primary pool; per group/member. | Membership state-machine, owner exclusion, replay, and provider-after-commit tests. Generic callbacks or unbounded projections move to `P1-12`. | **retain candidate**; no removal PR. |
| `R-17` | Delivery/provider-event state transitions, including Telegram access-notice claims, whose provider send is outside the commit. | Named claim/accepted/failed updates; some helpers still use generic wrappers and are therefore tracked in `P1-13`. | Provider I/O is outside the retained named transitions. Mailbox-backed reaction/message ingestion maps separately to `P0-01`. | Fixed delivery/event rows; default transaction ceiling. | Primary pool; keyed by effect/provider event. | Unknown-outcome replay, monotonic receipts, and stale finalizer tests. | **retain candidate** for named transitions; generic wrappers remain `P1-13`. |
| `R-18` | Assistant model/configuration and the DB-only portions of preference updates, address-book projection, iMessage mini-app enrollment, and similar small member configuration commits. | Fixed member/configuration rows; external work occurs before/after where present. Mailbox-backed preference updates also map to `P0-01`. | No external/root-client work in the retained configuration-only portions. | Fixed rows/statements; default transaction ceiling. | Primary pool; per member. | Revision/idempotency tests and static callback checks. | **retain candidate**; no removal PR. |
| `S-01` | `lockHostedMemberRow` and sponsored-access row-lock helpers in `hosted-onboarding/shared.ts`. | Shared primitive, not an invariant owner. It inherits the caller's class and transaction budget. | The helper itself is DB-only; callers determine external reachability. | One member row or the member's active sponsorship rows; no independent hard caller bound. | Primary pool. | Every caller must appear in this catalog. The helper is never a blanket allowlist entry. Remove broad use as caller-specific CAS/unique owners land. | **retain as primitive only**; caller-owned PR. |

## Retained transaction and lock allowlist policy

An allowlist entry is evidence, not a blanket exemption. A retained owner may be
approved only when its review record contains all of the following:

1. the invariant owner and why one statement is insufficient;
2. a fixed maximum row count and statement count, or a hard batch bound;
3. proof that no provider, KMS, model, filesystem, dynamic import, retry sleep,
   root-Prisma checkout, or arbitrary callback is reachable;
4. maximum transaction acquisition, lock wait, and total transaction time;
5. foreground shared versus isolated/background capacity domain;
6. contention behavior: fail fast, skip locked, return retryable conflict, or
   another bounded yield behavior;
7. focused same-key/unrelated-key, stale-owner, and replay tests; and
8. a removal or mandatory re-review condition.

Rows `R-01` through `R-18` document current evidence and gaps. Only the
admission/probe primitives in `R-01` have a complete bounded retain record today;
the migration bodies do not inherit it. Rows `R-02` through `R-18` are safe
current-base non-findings, not allowlist entries: grouped rows must be split by
function and assigned exact numeric row, statement, acquisition, lock-wait, and
total-time maxima before allowlist admission. `P2-04` is explicitly not
allowlisted until contention hardening lands. A safe current call tree can remain
without a removal PR while still failing unqualified allowlist admission.

## Foreground global-expiry sweep register

| Owner | Current class | Current-base evidence | Required replacement |
| --- | --- | --- | --- |
| Device browser-assertion nonce | **P0** | Global expired delete in foreground consume transaction. | Unique insert; bounded background cleanup. |
| Internal request nonce | **P0** | Global expired delete in foreground consume transaction. PR `#1479` is tracked only. | Unique insert; bounded background cleanup. |
| Connected-app connect intent | **P1** | Global expired delete before foreground intent create. | Insert only; bounded background cleanup. |
| Clinical connect intent | **P1** | Global expired intent/session cleanup under member advisory; expired claim delete is rolled back by throw. | Separate cleanup; CAS claim; no delete-then-throw. |
| Clinical OAuth session | **P1** | Global expired session delete on create; expired consume delete rolls back on throw. | Separate cleanup; CAS consume. |
| Direct device OAuth/session | **P1** | Foreground global expiry delete before admission/session state. | Separate bounded cleanup. |
| Sensitive-action challenge | **P1** | Live production settings route calls global expired delete plus insert. | Insert only; bounded cleanup. |
| Device connect intent | **P2** | Global expired delete before create. | Insert only; bounded cleanup. |
| Companion HRV receipt | **P2** | Redundant foreground delete in inspection and under dirty-connection claim. | One bounded background cleanup. |

Relevant expiry columns are indexed. Indexing reduces scan cost but does not
bound row count, locked rows, lock wait, or total statement time. None of these
sweeps qualifies for an unqualified retained allowlist without a hard batch,
statement, wait, and contention contract.

## Approved replacement patterns

### Unique identity plus `INSERT ... ON CONFLICT ... RETURNING`

```sql
INSERT INTO effect (effect_key, owner_id, status)
VALUES ($1, $2, 'claimed')
ON CONFLICT (effect_key) DO NOTHING
RETURNING id, status;
```

The loser reads the canonical row after the statement only when it needs the
result. Do not take an advisory lock merely to avoid a unique violation.

### Conditional state transition / compare-and-swap

```sql
UPDATE job
SET status = 'claimed', version = version + 1, claimed_at = now()
WHERE id = $1
  AND status IN ('queued', 'retryable')
  AND version = $2
RETURNING id, status, version;
```

Zero rows is the conflict signal. A stale finalizer must include the version or
epoch it owns.

### Authority inside `INSERT ... SELECT`

```sql
INSERT INTO effect (effect_key, member_id, authority_version)
SELECT $1, membership.member_id, membership.version
FROM membership
WHERE membership.member_id = $2
  AND membership.status = 'active'
  AND membership.version = $3
ON CONFLICT (effect_key) DO NOTHING
RETURNING effect_key, authority_version;
```

This prevents a stale preflight read from becoming write authority.

### Set-based bounded `SKIP LOCKED` claim

```sql
WITH claimed AS (
  SELECT id
  FROM cleanup_item
  WHERE state = 'ready'
  ORDER BY id
  FOR UPDATE SKIP LOCKED
  LIMIT 500
)
UPDATE cleanup_item AS item
SET state = 'claimed', claim_epoch = item.claim_epoch + 1
FROM claimed
WHERE item.id = claimed.id
RETURNING item.id, item.claim_epoch;
```

Batch count, batch size, lock wait, and retry cadence must all be hard-coded and
tested. Background contention yields; it does not wait behind foreground work.

### External/KMS preparation before commit

Prepare deterministic IDs, provider payloads, local encryption context, and
ciphertext before checkout. The transaction receives immutable prepared values.
Zeroize local key material after the commit attempt. When AAD depends on a
sequence allocated in the commit, prewarm/unseal the root before checkout and
perform only local authenticated encryption inside the tiny transaction; do not
re-enter KMS or root Prisma.

### Stable provider idempotency: claim, call, finalize, reconcile

1. Commit a stable effect key and owner epoch.
2. Call the provider after commit using that same semantic idempotency key.
3. Finalize with `WHERE owner_epoch = $expected`.
4. On timeout or crash, reconcile the provider's authoritative state using the
   same effect identity; never invent a new semantic key.

### Domain state plus outbox/effect identity

Commit the authoritative domain state and a stable outbox/effect row in one
short transaction. Perform mailbox/provider delivery after commit. A retry
converges on the existing effect; notification failure cannot roll back already
completed provider or domain work.

### Revision or epoch ownership

Consent, connection, route, credential, projection, checkpoint, and deletion
state should expose a monotonic revision/epoch. Claims and finalizers include the
expected revision in their predicate instead of locking an entire member as a
generic mutex.

### Temporary fail-fast try-lock

`pg_try_advisory_xact_lock` is acceptable only for optional bounded background
or migration work that immediately yields, has a documented statement/lock
budget, and has a removal/review condition. It is not the long-term ownership
model for foreground idempotency.

## Failure and replay requirements

Every replacement must preserve all of the following:

- retry uses the same semantic effect/idempotency key;
- owner revision/epoch fences stale workers and finalizers;
- receipts/events are monotonic and a later authoritative receipt cannot be
  overwritten by an older retry;
- a finalizer cannot overwrite newer state;
- deletion or suspension cannot be resurrected by delayed work;
- provider unknown outcomes are reconciled rather than blindly repeated;
- cleanup cannot report completion before every durable obligation succeeds;
- mailbox/outbox effects remain exactly-once by stable identity; and
- local key material is zeroized after use without discarding durable recovery
  authority.

## Implementation order and PR ownership map

Branches below are planned or in flight only. This catalog does not claim that
they are merged, approved, green, unchanged after rebase, or complete.

| Branch | Scope from this catalog | Gate / status statement |
| --- | --- | --- |
| `agent/mailbox-db-critical-section` | `P0-01` core append and prepared local crypto context. | First. Must land before activation and higher-level mailbox callers claim safety. |
| `agent/device-sync-db-critical-section` | `P0-02`, `P0-09`, `P1-10`, `P2-02`, `P2-03`. | Include every admission caller, connection credential path, dirty supersession, wake persistence callback, and expiry owner. |
| `agent/phone-call-db-critical-section` | Historical phone P0 only. | No dedicated current-base P0; reopen only on new proof. Phone remains mailbox-dependent. |
| `agent/thread-routing-db-critical-section` | `P0-03`, `P1-06`, `P1-07`, relevant `P1-13`. | After mailbox; include pending group setup. |
| `agent/usage-credit-db-critical-section` | `P0-04` settlement/grant/referral ownership. | Does not close Stripe binding `P1-05`. |
| `agent/linq-inventory-db-critical-section` | `P1-08`. | Bulk snapshot apply; operator-only is not an exemption. |
| `agent/billing-stripe-critical-section` | `P0-07`. | Separate DB-only/prepared wrapper callers from provider-under-lock callers. |
| `agent/vault-share-db-critical-section` | `P1-02`. | Projection revision is the target CAS owner. |
| `agent/group-join-outreach-db-critical-section` | `P0-05`. | Must land before participant-lock removal and before account deletion. Cover proactive drain and webhook provider fence. |
| `agent/hosted-identity-auth-db-critical-section` | `P0-06`. | Remove live Privy/KMS work before participant/member/referrer lock removal. |
| `agent/runtime-log-cross-db-critical-section` | `P0-08`. | Runtime-log tombstone/authority change must precede account deletion. |
| `agent/member-activation-crypto-db-critical-section` | `P1-01`. | Mailbox is an order dependency. |
| `agent/clinical-oauth-db-critical-section` | `P1-03`. | Includes clinical expiry sweeps and persistence seals. |
| `agent/meal-photo-credential-db-critical-section` | `P1-04`. | Dedicated follow-up; authority revision becomes CAS owner. |
| `agent/usage-credit-stripe-binding-db-critical-section` | `P1-05`. | Separate from usage settlement. |
| `agent/account-deletion-db-critical-section` | `P2-01`. | After group outreach and runtime-log tombstone; preserve privacy atomicity. |
| `agent/migration-lock-guard` | `P1-14` operator admission/bounds and `P2-05` future migration admission/bounds; preserve `R-01`. | Not an application-transaction removal branch; labels transaction refactoring still needs its domain owner. |

Unassigned expiry/group-state owners in `P1-09`, `P1-11`, and `P1-12` require a
named PR owner before implementation. Safe/non-finding rows receive no removal
PR absent new proof.

## Production-safe observability runbook

Run these only through approved read-only helpers. Production output is private:
do not paste results into documentation, issues, PRs, or chat. Do not select
query text, parameter values, database URLs, raw rows, or direct identifiers.

Primary and isolated runtime-log databases are separate. Query each through its
approved helper; do not copy rows into another database or local file to emulate
a join. The labels database is a separately configured topology and must be
queried independently when reviewing `P1-14`; do not assume it shares or does
not share a server with either runtime database. PostgreSQL timestamp columns
without timezone must be interpreted using the owning application's documented
convention.

### Aggregate sessions and oldest transaction by application/state/wait class

```sql
SELECT
  application_name,
  state,
  COALESCE(wait_event_type, 'none') AS wait_class,
  count(*) AS session_count,
  max(now() - xact_start) FILTER (WHERE xact_start IS NOT NULL)
    AS oldest_transaction_age
FROM pg_stat_activity
WHERE datname = current_database()
GROUP BY application_name, state, COALESCE(wait_event_type, 'none')
ORDER BY session_count DESC, application_name, state, wait_class;
```

### Active transaction age and blockers without query text

```sql
SELECT
  pid,
  application_name,
  state,
  wait_event_type,
  wait_event,
  now() - xact_start AS transaction_age,
  now() - state_change AS state_age,
  pg_blocking_pids(pid) AS blocking_pids
FROM pg_stat_activity
WHERE datname = current_database()
  AND xact_start IS NOT NULL
ORDER BY xact_start;
```

### Blocker/waiter edges without statement contents

```sql
SELECT
  waiter.pid AS waiter_pid,
  waiter.application_name AS waiter_application,
  waiter.wait_event_type AS waiter_wait_class,
  waiter.wait_event AS waiter_wait_event,
  now() - waiter.xact_start AS waiter_transaction_age,
  blocker.pid AS blocker_pid,
  blocker.application_name AS blocker_application,
  blocker.wait_event_type AS blocker_wait_class,
  blocker.wait_event AS blocker_wait_event,
  now() - blocker.xact_start AS blocker_transaction_age
FROM pg_stat_activity AS waiter
CROSS JOIN LATERAL unnest(pg_blocking_pids(waiter.pid)) AS edge(blocker_pid)
JOIN pg_stat_activity AS blocker ON blocker.pid = edge.blocker_pid
WHERE waiter.datname = current_database()
ORDER BY waiter_transaction_age DESC, waiter_pid, blocker_pid;
```

### Lock counts by type/mode/granted

```sql
SELECT
  locktype,
  mode,
  granted,
  count(*) AS lock_count
FROM pg_locks
GROUP BY locktype, mode, granted
ORDER BY lock_count DESC, locktype, mode, granted;
```

### Idle-in-transaction count and oldest age

```sql
SELECT
  application_name,
  count(*) AS idle_in_transaction_count,
  max(now() - xact_start) AS oldest_idle_transaction_age
FROM pg_stat_activity
WHERE datname = current_database()
  AND state = 'idle in transaction'
GROUP BY application_name
ORDER BY idle_in_transaction_count DESC, application_name;
```

### Normalized statement aggregates without query text

When `pg_stat_statements` is approved and available:

```sql
SELECT
  dbid,
  userid,
  queryid,
  calls,
  total_exec_time,
  mean_exec_time,
  rows,
  shared_blks_read,
  shared_blks_written,
  temp_blks_read,
  temp_blks_written
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 100;
```

### PgBouncer admin/read-only path

Use the approved PgBouncer admin/read-only connection and capture aggregate
values only:

```sql
SHOW POOLS;
SHOW STATS;
SHOW CONFIG;
```

Revalidate pool mode, default and reserve sizes, client limit, waiting clients,
server/client active/idle counts, transaction counts, and average wait. Do not
paste the result rows; report only reviewed aggregate conclusions.

## Verification requirements for implementation PRs

Every P0/P1 implementation needs focused proof with a pool maximum of two and a
gated slow provider/KMS boundary:

1. same-key contention and unrelated-key concurrency;
2. provider/KMS delay while asserting no database transaction remains open;
3. crash and unknown-provider-outcome replay with the same semantic key;
4. stale-finalizer fencing and monotonic receipt/event behavior;
5. no deletion/suspension resurrection;
6. exactly-once durable domain/outbox effects;
7. hard row, statement, batch, attempt, and wait bounds for retained loops or
   claims; and
8. a direct assertion that no root Prisma checkout occurs in a transaction-owned
   call tree.

Where practical, add static policy tests or review checks that reject provider
SDK, secure-box/KMS, root-Prisma, filesystem, dynamic import, retry sleep,
`Promise.all`, or arbitrary callback use inside transaction callbacks. Static
checks supplement, rather than replace, the two-connection runtime proof.

## Appendix A: mechanically checkable source-to-decision index

This appendix is generated from the current-base structural inventory. It maps
all production files containing an interactive transaction, a
`Prisma.TransactionClient` helper, an explicit lock/timeout/serializable
primitive, a migration execution body, or an operator SQL transaction to at
least one decision row above. A path can map to both its direct owner and a
shared dependency.

The table is normalized deliberately: every source row carries its mechanical
match kind and references one or more decision rows; the referenced decision row
contains the owner/callsites, transaction shape, external/data-dependent
reachability, capacity domain, classification, replacement or retain rationale,
and planned PR owner. Grouping is valid only while all mapped callsites share
that primitive and risk decision. This avoids copying risk prose 196 times while
making omissions and many-to-one ownership mechanically checkable.

| Source path | Mechanical match | Catalog row(s) |
| --- | --- | --- |
| `apps/web/app/api/action-approvals/[approvalId]/decision/route.ts` | interactive tx × 2 | `P0-01` |
| `apps/web/app/api/device-sync/companion/initial-onboarding/route.ts` | interactive tx × 1 | `P1-01`, `P0-01` |
| `apps/web/app/api/device-sync/companion/meal-photo-capture/photos/route.ts` | interactive tx × 2 | `P1-04`, `P0-01` |
| `apps/web/app/api/environment/voice/route.ts` | interactive tx × 2 | `P0-01` |
| `apps/web/app/api/groups/join/[joinCode]/accept/route.ts` | interactive tx × 1 | `R-16` |
| `apps/web/app/api/groups/join/[joinCode]/leave/route.ts` | interactive tx × 1 | `R-16` |
| `apps/web/app/api/groups/start/recover/route.ts` | interactive tx × 1 | `P0-03` |
| `apps/web/app/api/internal/hosted-execution/email/register-reply-alias/route.ts` | interactive tx × 1 | `P0-06` |
| `apps/web/app/api/internal/hosted-mailbox/email-ingress/route.ts` | interactive tx × 1 | `P0-01` |
| `apps/web/app/api/internal/hosted-runtime/linq-egress/delivery/route.ts` | interactive tx × 1 | `R-17` |
| `apps/web/app/api/internal/hosted-runtime/linq-egress/engagement/route.ts` | interactive tx × 1 | `P0-03` |
| `apps/web/app/api/internal/hosted-runtime/thread-route/authority/route.ts` | interactive tx × 1 | `P0-03` |
| `apps/web/app/api/settings/assistant-model/route.ts` | interactive tx × 1 | `R-18` |
| `apps/web/app/api/settings/assistant-style/route.ts` | interactive tx × 1 | `P0-01`, `R-18` |
| `apps/web/app/api/settings/billing/family/checkout/route.ts` | interactive tx × 1 | `R-14` |
| `apps/web/app/api/settings/billing/family/invite/[inviteId]/route.ts` | interactive tx × 1 | `R-14` |
| `apps/web/app/api/settings/billing/family/invite/route.ts` | interactive tx × 1 | `R-14` |
| `apps/web/app/api/settings/billing/family/members/[memberId]/route.ts` | interactive tx × 1 | `R-14` |
| `apps/web/app/api/settings/email/sync/route.ts` | interactive tx × 1 | `P1-01` |
| `apps/web/app/api/settings/initial-onboarding/route.ts` | interactive tx × 1 | `P1-01` |
| `apps/web/app/api/settings/phone/sync/route.ts` | interactive tx × 2 | `P0-06` |
| `apps/web/app/api/settings/telegram/sync/route.ts` | interactive tx × 1 | `P1-01` |
| `apps/web/prisma/contract-migrations/20260708000000_contract_migration_smoke/migration.sql` | contract migration body | `P2-05` |
| `apps/web/prisma/contract-migrations/20260711230000_drop_group_join_compatibility_bridges/migration.sql` | contract migration body | `P2-05` |
| `apps/web/prisma/contract-migrations/20260712183000_require_preference_causal_seq/migration.sql` | contract migration body | `P2-05` |
| `apps/web/prisma/contract-migrations/20260713150000_require_assistant_personality_ranges/migration.sql` | contract migration body | `P2-05` |
| `apps/web/prisma/contract-migrations/20260714120000_seed_assistant_preference_projection_watermarks/migration.sql` | contract migration body | `P2-05` |
| `apps/web/prisma/contract-migrations/20260714150000_require_hosted_family_plan_codes/migration.sql` | contract migration body | `P2-05` |
| `apps/web/prisma/contract-migrations/20260715150000_delete_orphaned_linq_invite_deliveries_after_drain/migration.sql` | contract migration body | `P2-05` |
| `apps/web/prisma/contract-migrations/20260715190000_drop_usage_notice_compatibility_marker/migration.sql` | contract migration body | `P2-05` |
| `apps/web/prisma/contract-migrations/20260715193000_seed_hosted_assistant_personality_projection_watermarks/migration.sql` | contract migration body | `P2-05` |
| `apps/web/prisma/contract-migrations/20260720233000_hosted_group_usage_funding_invariants/migration.sql` | contract migration body | `P2-05` |
| `apps/web/prisma/contract-migrations/20260726123000_allow_hosted_usage_referral_credit_entries/migration.sql` | contract migration body | `P2-05` |
| `apps/web/prisma/contract-migrations/20260728031000_resynchronize_hosted_usage_credit_purchase_grants/migration.sql` | contract migration body; explicit row/table lock | `P2-05` |
| `apps/web/prisma/contract-migrations/20260729183000_rebuild_linq_delivery_health_after_drain/migration.sql` | contract migration body | `P2-05` |
| `apps/web/prisma/contract-migrations/20260731123000_anonymize_product_feedback_after_drain/migration.sql` | contract migration body | `P2-05` |
| `apps/web/prisma/contract-migrations/20260805233000_meal_photo_authority_invariants/migration.sql` | contract migration body | `P2-05` |
| `apps/web/prisma/contract-migrations/20260806222000_validate_hosted_pulse_trial_start_source/migration.sql` | contract migration body | `P2-05` |
| `apps/web/prisma/contract-migrations/20260807162546_drop_hosted_runtime_log_after_drain/migration.sql` | contract migration body | `P2-05` |
| `apps/web/prisma/migrations/20260726120000_hosted_growth_aggregate/migration.sql` | raw transaction; table lock | `P2-05` |
| `apps/web/prisma/migrations/20260728030000_hosted_usage_referral_credit_entry_constraints/migration.sql` | raw transaction; local lock timeout | `P2-05` |
| `apps/web/prisma/migrations/20260730233000_hosted_inference_connection/migration.sql` | raw transaction; local lock timeout | `P2-05` |
| `apps/web/prisma/migrations/20260801010000_hosted_inference_connection_revision_seq/migration.sql` | raw transaction; local lock timeout | `P2-05` |
| `apps/web/prisma/migrations/20260805160000_hosted_usage_plan_reset_epoch/migration.sql` | raw transaction; table lock | `P2-05` |
| `apps/web/prisma/migrations/20260806180000_fix_hosted_usage_plan_transition_bridge/migration.sql` | raw transaction; table lock | `P2-05` |
| `apps/web/scripts/run-prisma-migrate-deploy.ts` | migration runner | `P2-05` |
| `apps/web/scripts/run-production-contract-migrations.ts` | explicit lock/timeout × 1 | `R-01`, `P2-05` |
| `apps/web/scripts/run-runtime-log-migrate-deploy.ts` | explicit lock/timeout × 4 | `R-01` |
| `apps/web/scripts/sync-hosted-linq-lines.ts` | interactive tx × 1 | `P1-08` |
| `apps/web/sql/foods/import-fdc.sql` | raw operator transaction; local file copy | `P1-14` |
| `apps/web/sql/product-tests/backfill-serving-grams.sql` | raw operator transaction; advisory lock; local file copy | `P1-14` |
| `apps/web/sql/product-tests/import-open-product-sources.sql` | raw operator transaction; local file copy | `P1-14` |
| `apps/web/sql/product-tests/import-plasticlist.sql` | raw operator transaction; local file copy | `P1-14` |
| `apps/web/sql/product-tests/import-product-test-remaps.sql` | raw operator transaction; advisory lock; local file copy | `P1-14` |
| `apps/web/sql/product-tests/import-source-only-product-tests-body.sql` | advisory lock | `P1-14` |
| `apps/web/sql/product-tests/import-thresholds.sql` | raw operator transaction; advisory lock; local file copy | `P1-14` |
| `apps/web/sql/supplements/import-dailymed.sql` | raw operator transaction; local file copy | `P1-14` |
| `apps/web/sql/supplements/import.sql` | raw operator transaction; local file copy | `P1-14` |
| `apps/web/sql/supplements/repair-data-quality-2026-07.sql` | raw operator transaction; advisory lock | `P1-14` |
| `apps/web/src/lib/action-approvals.ts` | tx-client helper × 1 | `P0-01` |
| `apps/web/src/lib/browser-vault/authority.ts` | tx-client helper × 1 | `R-09` |
| `apps/web/src/lib/clinical-records/connect-intents.ts` | interactive tx × 2; explicit lock/timeout × 1 | `P1-03` |
| `apps/web/src/lib/clinical-records/connections.ts` | interactive tx × 1 | `P1-03`, `R-08` |
| `apps/web/src/lib/clinical-records/control-plane.ts` | interactive tx × 3 | `P1-03` |
| `apps/web/src/lib/clinical-records/retrieval.ts` | interactive tx × 5 | `P1-03`, `P0-01`, `R-08` |
| `apps/web/src/lib/codex-auth/store.ts` | interactive tx × 1 | `P0-01`, `R-18` |
| `apps/web/src/lib/computer-use/store.ts` | interactive tx × 11; tx-client helper × 7; explicit lock/timeout × 2 | `R-10` |
| `apps/web/src/lib/connected-apps/service.ts` | interactive tx × 2; tx-client helper × 2 | `P1-09` |
| `apps/web/src/lib/device-sync/connect-intents.ts` | interactive tx × 2 | `P2-02` |
| `apps/web/src/lib/device-sync/meal-photo-capture.ts` | interactive tx × 5; tx-client helper × 3 | `P1-04` |
| `apps/web/src/lib/device-sync/prisma-store.ts` | interactive tx × 2; explicit lock/timeout × 2 | `P0-02` |
| `apps/web/src/lib/device-sync/prisma-store/agent-sessions.ts` | interactive tx × 3 | `R-07` |
| `apps/web/src/lib/device-sync/prisma-store/browser-assertion-nonces.ts` | interactive tx × 1 | `P0-09` |
| `apps/web/src/lib/device-sync/prisma-store/connections.ts` | interactive tx × 2; explicit lock/timeout × 2 | `P0-02` |
| `apps/web/src/lib/device-sync/prisma-store/dirty-connections.ts` | interactive tx × 2; explicit lock/timeout × 2 | `P0-02`, `P2-03` |
| `apps/web/src/lib/device-sync/prisma-store/oauth-sessions.ts` | interactive tx × 1 | `P1-10` |
| `apps/web/src/lib/device-sync/prisma-store/webhook-traces.ts` | interactive tx × 1 | `R-07` |
| `apps/web/src/lib/device-sync/reconnect-link-tool.ts` | interactive tx × 1 | `P2-02` |
| `apps/web/src/lib/device-sync/wake-service.ts` | interactive tx × 1 | `P0-02`, `P0-01` |
| `apps/web/src/lib/device-sync/webhook-trace-owner-lock.ts` | tx-client helper × 2; explicit lock/timeout × 2 | `R-07` |
| `apps/web/src/lib/hosted-address-book/projection.ts` | interactive tx × 2; tx-client helper × 1 | `R-18` |
| `apps/web/src/lib/hosted-crypto/domain-root-store.ts` | interactive tx × 2; explicit lock/timeout × 1 | `P0-06` |
| `apps/web/src/lib/hosted-execution/assistant-configuration-tool.ts` | interactive tx × 1 | `R-18` |
| `apps/web/src/lib/hosted-execution/assistant-personalization-tool.ts` | interactive tx × 2 | `P0-01`, `R-18` |
| `apps/web/src/lib/hosted-execution/family-plan-tool.ts` | interactive tx × 3 | `R-18` |
| `apps/web/src/lib/hosted-execution/imessage-contact-tool.ts` | interactive tx × 1 | `R-18` |
| `apps/web/src/lib/hosted-execution/internal-request-nonces.ts` | interactive tx × 1 | `P0-10` |
| `apps/web/src/lib/hosted-execution/product-feedback.ts` | interactive tx × 1; explicit lock/timeout × 1 | `R-02` |
| `apps/web/src/lib/hosted-execution/telegram-access-notice.ts` | interactive tx × 1 | `R-17` |
| `apps/web/src/lib/hosted-execution/usage-allowance.ts` | interactive tx × 2; tx-client helper × 15; explicit lock/timeout × 2 | `P0-04` |
| `apps/web/src/lib/hosted-execution/usage-credit-grant.ts` | tx-client helper × 1 | `P0-04` |
| `apps/web/src/lib/hosted-execution/usage-credit-ledger.ts` | tx-client helper × 4; explicit lock/timeout × 2 | `P0-04` |
| `apps/web/src/lib/hosted-execution/usage-credit-net-reversal.ts` | tx-client helper × 4 | `P0-04` |
| `apps/web/src/lib/hosted-execution/usage-credit-purchase-grant.ts` | tx-client helper × 1 | `P0-04` |
| `apps/web/src/lib/hosted-execution/usage-credit-usage-settlement.ts` | tx-client helper × 2; explicit lock/timeout × 1 | `P0-04` |
| `apps/web/src/lib/hosted-execution/usage-limit-notice-claim.ts` | interactive tx × 1; tx-client helper × 4; explicit lock/timeout × 2 | `R-04` |
| `apps/web/src/lib/hosted-execution/usage.ts` | interactive tx × 1; tx-client helper × 4 | `P0-04` |
| `apps/web/src/lib/hosted-groups/group-assistant-ask.ts` | interactive tx × 3; tx-client helper × 13; explicit lock/timeout × 2 | `P1-06`, `P0-01` |
| `apps/web/src/lib/hosted-groups/group-current-sender-assistant-ask.ts` | interactive tx × 1; tx-client helper × 4; explicit lock/timeout × 1 | `P1-06`, `P0-01` |
| `apps/web/src/lib/hosted-groups/group-disclosure-store.ts` | tx-client helper × 6 | `P1-06` |
| `apps/web/src/lib/hosted-groups/group-join-confirmation.ts` | interactive tx × 1; tx-client helper × 3 | `P0-01`, `R-16` |
| `apps/web/src/lib/hosted-groups/group-join-outreach-drain.ts` | interactive tx × 1; tx-client helper × 6; explicit lock/timeout × 1 | `P0-05` |
| `apps/web/src/lib/hosted-groups/group-join-outreach-store.ts` | tx-client helper × 6; explicit lock/timeout × 4 | `P0-05` |
| `apps/web/src/lib/hosted-groups/group-newsletter.ts` | interactive tx × 2 | `P1-12`, `P0-01` |
| `apps/web/src/lib/hosted-groups/group-offer-affirmation.ts` | interactive tx × 2; tx-client helper × 1 | `P1-12`, `R-16` |
| `apps/web/src/lib/hosted-groups/group-sponsorship-authorization.ts` | interactive tx × 3; tx-client helper × 16 | `P1-06` |
| `apps/web/src/lib/hosted-groups/group-sponsorship-notification.ts` | interactive tx × 1; tx-client helper × 1 | `P1-06`, `P0-01` |
| `apps/web/src/lib/hosted-groups/group-sponsorship-refill-dispatch.ts` | interactive tx × 1 | `P1-06` |
| `apps/web/src/lib/hosted-groups/group-sponsorship-store.ts` | tx-client helper × 4 | `P1-06` |
| `apps/web/src/lib/hosted-groups/group-store.ts` | interactive tx × 2; tx-client helper × 23; explicit lock/timeout × 3 | `P1-12`, `R-16` |
| `apps/web/src/lib/hosted-groups/group-tool.ts` | interactive tx × 11 | `R-16` |
| `apps/web/src/lib/hosted-groups/join-offer-reaction.ts` | interactive tx × 4; tx-client helper × 2 | `P0-05`, `P0-01` |
| `apps/web/src/lib/hosted-groups/pending-group-setup.ts` | tx-client helper × 10; explicit lock/timeout × 1 | `P1-07` |
| `apps/web/src/lib/hosted-groups/prepared-thread-container.ts` | tx-client helper × 1 | `P0-03`, `P0-01` |
| `apps/web/src/lib/hosted-groups/thread-container-participant-access.ts` | tx-client helper × 2 | `P0-03` |
| `apps/web/src/lib/hosted-growth/signup-referral-notification.ts` | interactive tx × 1 | `P0-01` |
| `apps/web/src/lib/hosted-growth/signup-referral-reward.ts` | interactive tx × 1; tx-client helper × 5; explicit lock/timeout × 2 | `P0-04` |
| `apps/web/src/lib/hosted-growth/signup-referral.ts` | interactive tx × 1; tx-client helper × 3; explicit lock/timeout × 1 | `P0-04` |
| `apps/web/src/lib/hosted-growth/usage-referral.ts` | interactive tx × 4; tx-client helper × 13; explicit lock/timeout × 3 | `P0-04`, `P0-01` |
| `apps/web/src/lib/hosted-inference/connection-store.ts` | interactive tx × 3; tx-client helper × 1 | `R-12` |
| `apps/web/src/lib/hosted-mailbox/runtime-access.ts` | tx-client helper × 5; explicit lock/timeout × 2 | `P1-06` |
| `apps/web/src/lib/hosted-mailbox/store.ts` | interactive tx × 3; explicit lock/timeout × 3 | `P0-01` |
| `apps/web/src/lib/hosted-onboarding/app-session.ts` | interactive tx × 1; tx-client helper × 1 | `P0-06` |
| `apps/web/src/lib/hosted-onboarding/authentication-service.ts` | interactive tx × 2; tx-client helper × 2 | `P0-06` |
| `apps/web/src/lib/hosted-onboarding/auto-trial-enrollment-service.ts` | tx-client helper × 6 | `P0-07` |
| `apps/web/src/lib/hosted-onboarding/billing-plan-switch-to-pulse-service.ts` | tx-client helper × 4 | `P0-07` |
| `apps/web/src/lib/hosted-onboarding/billing-service.ts` | interactive tx × 4; tx-client helper × 2 | `R-14` |
| `apps/web/src/lib/hosted-onboarding/billing-start-paid-pulse-service.ts` | interactive tx × 1 | `P0-07` |
| `apps/web/src/lib/hosted-onboarding/family-plan.ts` | interactive tx × 10; tx-client helper × 38 | `P0-07`, `P0-01`, `R-14` |
| `apps/web/src/lib/hosted-onboarding/group-reaction-mailbox.ts` | tx-client helper × 1 | `P0-01` |
| `apps/web/src/lib/hosted-onboarding/hosted-member-billing-store.ts` | interactive tx × 3; tx-client helper × 12; explicit lock/timeout × 2 | `P0-07` |
| `apps/web/src/lib/hosted-onboarding/hosted-member-identity-store.ts` | tx-client helper × 1 | `P0-06` |
| `apps/web/src/lib/hosted-onboarding/hosted-member-routing-linq.ts` | tx-client helper × 15; explicit lock/timeout × 2 | `P0-03` |
| `apps/web/src/lib/hosted-onboarding/hosted-member-routing-store.ts` | tx-client helper × 2; explicit lock/timeout × 1 | `P0-03` |
| `apps/web/src/lib/hosted-onboarding/hosted-member-routing-telegram.ts` | interactive tx × 1; tx-client helper × 2 | `P0-03` |
| `apps/web/src/lib/hosted-onboarding/hosted-member-store.ts` | interactive tx × 1; tx-client helper × 9 | `P0-06` |
| `apps/web/src/lib/hosted-onboarding/hosted-member-stripe-customer.ts` | interactive tx × 1 | `P0-07` |
| `apps/web/src/lib/hosted-onboarding/initial-onboarding.ts` | tx-client helper × 1 | `P1-01`, `P0-01` |
| `apps/web/src/lib/hosted-onboarding/invite-service.ts` | interactive tx × 5; tx-client helper × 3 | `P1-01` |
| `apps/web/src/lib/hosted-onboarding/linq-delivery-store.ts` | interactive tx × 2; tx-client helper × 2; explicit lock/timeout × 1 | `P1-13`, `R-17` |
| `apps/web/src/lib/hosted-onboarding/linq-first-contact-admission.ts` | explicit lock/timeout × 1 | `R-03` |
| `apps/web/src/lib/hosted-onboarding/linq-home-routing.ts` | tx-client helper × 10 | `P0-03` |
| `apps/web/src/lib/hosted-onboarding/linq-line-store.ts` | interactive tx × 2; tx-client helper × 2; explicit lock/timeout × 5 | `P1-08` |
| `apps/web/src/lib/hosted-onboarding/linq-participant-contact.ts` | tx-client helper × 2; explicit lock/timeout × 2 | `R-03` |
| `apps/web/src/lib/hosted-onboarding/linq-phone-number-inventory.ts` | interactive tx × 1 | `P1-08` |
| `apps/web/src/lib/hosted-onboarding/linq-provider-event-store.ts` | tx-client helper × 1 | `R-17` |
| `apps/web/src/lib/hosted-onboarding/member-activation.ts` | tx-client helper × 9 | `P1-01`, `P0-01` |
| `apps/web/src/lib/hosted-onboarding/member-channel-sync.ts` | tx-client helper × 3 | `P1-01`, `P0-01` |
| `apps/web/src/lib/hosted-onboarding/member-identity-service.ts` | interactive tx × 3; tx-client helper × 10; explicit lock/timeout × 1 | `P0-06` |
| `apps/web/src/lib/hosted-onboarding/member-preferences.ts` | tx-client helper × 3 | `P0-01`, `R-18` |
| `apps/web/src/lib/hosted-onboarding/privy-phone-transfer-retirement.ts` | tx-client helper × 10 | `P0-06` |
| `apps/web/src/lib/hosted-onboarding/pulse-trial-subscription-cleanup.ts` | tx-client helper × 1 | `P0-07`, `R-14` |
| `apps/web/src/lib/hosted-onboarding/shared.ts` | tx-client helper × 2; explicit lock/timeout × 3 | `S-01` |
| `apps/web/src/lib/hosted-onboarding/stripe-billing-events.ts` | interactive tx × 1; tx-client helper × 15 | `P0-07`, `R-14` |
| `apps/web/src/lib/hosted-onboarding/stripe-billing-policy.ts` | tx-client helper × 4 | `P0-07` |
| `apps/web/src/lib/hosted-onboarding/stripe-event-reconciliation.ts` | interactive tx × 2; tx-client helper × 3 | `P0-07`, `R-14` |
| `apps/web/src/lib/hosted-onboarding/subscription-checkout-store.ts` | tx-client helper × 1 | `R-14` |
| `apps/web/src/lib/hosted-onboarding/telegram-group-reactions.ts` | interactive tx × 1 | `P0-01`, `R-17` |
| `apps/web/src/lib/hosted-onboarding/usage-credit-purchase-account-deletion.ts` | interactive tx × 3 | `P2-01`, `R-14` |
| `apps/web/src/lib/hosted-onboarding/usage-credit-purchase-service.ts` | interactive tx × 4; tx-client helper × 1 | `P1-05` |
| `apps/web/src/lib/hosted-onboarding/usage-credit-purchase-status-service.ts` | interactive tx × 3; tx-client helper × 1 | `P1-05` |
| `apps/web/src/lib/hosted-onboarding/usage-credit-saved-card-payment.ts` | interactive tx × 4 | `P1-05` |
| `apps/web/src/lib/hosted-onboarding/usage-credit-stripe-checkout-reconciliation.ts` | tx-client helper × 2 | `R-14` |
| `apps/web/src/lib/hosted-onboarding/usage-credit-stripe-direct-payment-reconciliation.ts` | tx-client helper × 2 | `R-14` |
| `apps/web/src/lib/hosted-onboarding/usage-credit-stripe-financial-reconciliation.ts` | tx-client helper × 3 | `R-14` |
| `apps/web/src/lib/hosted-onboarding/usage-credit-stripe-reconciliation-context.ts` | tx-client helper × 1 | `R-14` |
| `apps/web/src/lib/hosted-onboarding/webhook-provider-linq-participant-context.ts` | tx-client helper × 2 | `P0-03`, `P1-07`, `R-17` |
| `apps/web/src/lib/hosted-onboarding/webhook-provider-linq-reaction-context.ts` | interactive tx × 1; tx-client helper × 1 | `P0-01`, `R-17` |
| `apps/web/src/lib/hosted-onboarding/webhook-provider-linq-shared.ts` | tx-client helper × 4 | `P0-03`, `R-17` |
| `apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts` | tx-client helper × 12 | `P0-01`, `P0-03`, `P1-13`, `R-17` |
| `apps/web/src/lib/hosted-onboarding/webhook-provider-telegram.ts` | tx-client helper × 1 | `P0-01`, `P0-03`, `P1-13`, `R-17` |
| `apps/web/src/lib/hosted-onboarding/webhook-service.ts` | interactive tx × 1; tx-client helper × 3 | `P0-01`, `P0-03`, `P1-13`, `R-17` |
| `apps/web/src/lib/hosted-onboarding/webhook-transport.ts` | interactive tx × 2; tx-client helper × 5 | `P0-05`, `P1-13`, `R-17` |
| `apps/web/src/lib/hosted-ops/app-review-member.ts` | interactive tx × 1 | `R-15` |
| `apps/web/src/lib/hosted-ops/linq-line-rehome.ts` | interactive tx × 1 | `P1-08` |
| `apps/web/src/lib/hosted-ops/member-usage.ts` | interactive tx × 1; explicit lock/timeout × 3 | `R-15` |
| `apps/web/src/lib/hosted-ops/pulse-trial-extension.ts` | tx-client helper × 3 | `P0-07` |
| `apps/web/src/lib/hosted-orchestration/signal-runtime.ts` | interactive tx × 1 | `P0-01` |
| `apps/web/src/lib/hosted-privacy/account-data-service.ts` | interactive tx × 3; tx-client helper × 10; explicit lock/timeout × 3 | `P2-01` |
| `apps/web/src/lib/hosted-privacy/account-deletion-cleanup.ts` | tx-client helper × 1 | `P2-01` |
| `apps/web/src/lib/hosted-retention/cleanup.ts` | tx-client helper × 1; explicit lock/timeout × 1 | `P2-04` |
| `apps/web/src/lib/hosted-routing/linq-chat-ownership-lock.ts` | tx-client helper × 1; explicit lock/timeout × 1 | `P0-03` |
| `apps/web/src/lib/hosted-routing/thread-container-service.ts` | tx-client helper × 6; explicit lock/timeout × 1 | `P0-03`, `P0-01` |
| `apps/web/src/lib/hosted-routing/thread-route-store.ts` | tx-client helper × 12; explicit lock/timeout × 1 | `P0-03` |
| `apps/web/src/lib/hosted-runtime-latency/store.ts` | interactive tx × 5; explicit lock/timeout × 1 | `R-06` |
| `apps/web/src/lib/hosted-runtime-log/store.ts` | explicit lock/timeout × 3 | `P0-08` |
| `apps/web/src/lib/hosted-vault-share/projection-store.ts` | interactive tx × 1; tx-client helper × 1 | `P1-02` |
| `apps/web/src/lib/hosted-vault-share/share-grant-store.ts` | tx-client helper × 2 | `P1-02` |
| `apps/web/src/lib/hosted-workspace/store.ts` | interactive tx × 2; explicit lock/timeout × 3 | `R-09` |
| `apps/web/src/lib/imessage-mini-app/service.ts` | interactive tx × 1; tx-client helper × 1 | `R-18` |
| `apps/web/src/lib/legal/consent.ts` | interactive tx × 3 | `R-11` |
| `apps/web/src/lib/phone-calls/result.ts` | interactive tx × 3; tx-client helper × 1 | `R-05`, `P0-01` |
| `apps/web/src/lib/phone-calls/service.ts` | interactive tx × 1 | `R-05` |
| `apps/web/src/lib/phone-calls/usage.ts` | interactive tx × 3; tx-client helper × 1 | `R-05` |
| `apps/web/src/lib/physical-notes/service.ts` | interactive tx × 3; tx-client helper × 1 | `R-13` |
| `apps/web/src/lib/sensitive-actions/server.ts` | interactive tx × 1 | `P1-11` |


## Appendix B: reviewer checklist

Before approving a new or retained transaction/lock:

- identify the invariant and the one row/key/revision that owns it;
- prove one statement is insufficient before accepting an interactive callback;
- list exact maximum rows, statements, attempts, lock wait, and total duration;
- search the complete callback call tree for root Prisma, provider SDKs, KMS or
  secure-box unwrap, model/filesystem calls, dynamic imports, sleeps,
  `Promise.all`, generic callbacks, and loops;
- verify same-key and unrelated-key behavior with a two-connection pool;
- require stable retry identity, stale-owner fencing, and unknown-outcome
  reconciliation;
- require background cleanup to yield under contention; and
- record the test and the removal/re-review condition in this catalog.
