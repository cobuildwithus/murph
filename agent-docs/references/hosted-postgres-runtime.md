# Hosted Postgres runtime ownership

## Authority and activation

`HostedRuntimeOwner` in Web's primary Postgres database owns member execution
admission. The durable `HostedRuntimeCutover` gate selects `legacy`, `draining`,
`rolling`, or `postgres`. `HOSTED_RUNTIME_POSTGRES_ENABLED` is a deployment
capability, not a fleet-wide backend selector. With that capability enabled,
`rolling` routes each member by explicit migration phase; unregistered existing
members remain legacy. Disabled deployments cannot start migrated members.

Migration phase is separate from execution phase: `legacy -> quiescing ->
freezing -> importing -> postgres`. Importing an owner row alone never activates
execution. Quiescing keeps admitted callbacks available for checkpointing while
closing new starts and destructive deletion. Freezing/importing admit no new
execution. Activation requires the complete exact-source import and commits a
durable wake through the existing mailbox/Temporal scheduler.

Canonical `hosted_member` insertion enrolls new personal and group runtime
members as `pending` during rolling mode through a database trigger, in the same
transaction as creation. This covers older Web writers as well as the current
`hosted-member-store.ts::createHostedMember` helper. Pending admits neither runtime:
a new member row cannot prove an overlapping old Worker never created its source.
It requires the same exact-source retirement and durable activation wake as an
existing member. Global legacy/Postgres modes derive their backend from the gate.
The FK-free owner survives deletion; a conflicting old owner cannot be overwritten
by creation. The trigger takes a nonblocking shared campaign lock because some
creators already hold identity/family locks. The current helper acquires that lock
before insertion to return the existing retryable setup error; an old writer's
contended insert fails atomically for retry. Neither path waits in an inverted
lock order. Canonical and late-source enrollment and automatic first-use progress are
implemented below; composed onboarding/rollout proof remains a release prerequisite.

The `UserRunnerDurableObject` implementation remains a finite migration bridge.
Descriptions of its runtime ownership in the mailbox protocol apply only before
cutover. After activation, ordinary execution, provider authorization, snapshot
sessions, media, replica writes, status, consent, and deletion use Web/Postgres.
The native `RunnerContainer` and memberless standby inventory remain in use.
Temporal remains the pointer-only scheduler and retry owner. No Workflow names,
signals, task queues, or replay command ordering change.

## Claim, launch, completion, and recovery

The owner row has a monotonically increasing generation and one attempt. Its
phases are `idle -> starting -> active -> retiring -> idle`. Claim records an
allocation ID before an external allocation call. Target selection records the
immutable slot before native binding. Preparation binds workspace start version,
processing mode, the provider-token hash, encrypted inference settings, and
managed-AI allowance once. The opaque provider token travels only in the job.
The workspace checkpoint compare-and-swap version is independent of generation.

Preparation and native readiness overlap. The native slot verifies fresh Web
authority and persists its invocation receipt before starting execution.
Registered/completed receipts survive activation loss. A duplicate registration
cannot execute the attempt twice. An uncertain launch or stop retains the exact
target; age can schedule reconciliation but cannot authorize its replacement.

Completion revokes ordinary effects and records completion before the adapter
releases ownership. Reuse additionally requires the exact native completed
receipt and either a settled native invocation or an inactive runtime fence
proved during reconciliation. Successful release retains the member's
warm target. Failed or ambiguous retirement requires exact native stop proof
before clearing its assignment. Bound slots never return to shared inventory.

The runtime completion callback and outer invocation result share the same
native receipt and Web retirement operation. An early callback cannot release
the still-running outer invocation. The settled outer result releases ownership
before sending the advisory Temporal hint; its failure leaves durable completion
for the normal recheck. Bounded phase-only failure metadata is recorded before
native stop, without granting or releasing authority.

## Transactions and effects

Ordinary runtime requests bind attempt/generation to their signed Web callback.
The Worker rejects caller-supplied authority query parameters and derives those
parameters from authenticated runtime headers. Web validates admission and the
canonical mutation in the same transaction. No standalone UserRunner preflight
is added to that callback. Provider effects still require fresh authorization at
the Worker boundary; no cached positive allowance can outlive revocation.

Lock order is the cutover gate, member, runtime owner, then workspace/mailbox and
resource rows. Transactions contain bounded database work only, with five-second
transaction/admission limits. External allocation, container operations, provider
calls, and R2 writes run outside transactions.

The native usage-settlement receipt is a negative latch: pending or denied
settlement blocks managed provider access. Only an explicit allowance response
clears that report's pending latch. Eviction or an unknown response cannot grant
access. Postgres retains the canonical usage and credit ledger.

## Uploads and deletion

Snapshot upload sessions, independent PUT drains, terminal media descriptors,
and typed orphan candidates live in Postgres. These obligations have no member
foreign key so account deletion cannot erase physical cleanup requirements.
Snapshot sessions retain existing presign admission and capability-drain policy;
fresh final admission precedes returning a presigned capability.

Worker-owned media, private images, and each replica shard use recoverable R2
multipart uploads. An empty upload is created first; its exact object key and
upload ID are admitted in Postgres before sending encrypted bytes. Each physical
write has a separate receipt. Completion or confirmed abort releases that
receipt. An unknown completion followed by an unknown abort leaves it pending.
Stopping a runtime never converts a multipart receipt into a timed drain.

The existing bounded retention sweep reconciles pending uploads after 65 minutes
by aborting the exact upload ID. That timestamp schedules recovery; it is not
proof that the write stopped. The Worker accepts only the bound member's flat
media/private-media/replica namespaces and treats only R2 `NoSuchUpload` (10024)
as an already-finished abort. Failures remain pending and retry after a minute.
Account deletion requests immediate reconciliation after the member is gone,
then waits for all write obligations before physical namespace deletion.

Replica cleanup owns the root and its derived shard family; individual upload
receipts prevent a successful sibling from releasing a failed sibling's write.
Media retirement is terminal and revision-acknowledged. Canonical snapshot and
replica refs protect retained objects from orphan deletion. Provisional media
rows carry a 65-minute orphan deadline and `registered=false`; first successful
registration replaces that deadline with the descriptor's product expiry.
Registered rows, including legacy imports, retain the existing minimum-expiry
rule on repeated finite registrations. A retired row can never be revived.
Existing private
image capability expiry and the R2 lifecycle policy remain the expiry owner.

R2 contracts: [multipart upload and abort](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/),
[error codes](https://developers.cloudflare.com/r2/api/error-codes/), and
[strong consistency](https://developers.cloudflare.com/r2/reference/consistency/).
Strong delete consistency alone does not cancel a concurrent write.

## Rolling migration readiness

Production migration remains a separate authorized operation. The rolling
implementation is not yet a complete operational release: canonical enrollment,
late-source recovery, automatic first-use handoff proof, release compatibility,
composed rehearsal and final public review are still required. `migrateHostedLegacyRuntime` now starts a rolling campaign, reconciles
provider discovery with creation intents, closes legacy creation and seals the
ordered inventory. It never invokes the old fleet-draining path.

Before closing creation, the Worker enrolls canonical members (including group
runtime members) and retained runtime owners, snapshot uploads, write drains,
media and orphan identities. Web returns at most 100 unenrolled identities per
call using one statement with at most 100 distinct candidates per state owner;
unique expected-source bindings replace a mutable pagination cursor. The Worker
uses `USER_RUNNER.idFromName` without obtaining a stub, so enrollment does not
materialize or start a source. One database transaction binds the page and retains
missing owners, without replacing pending signup phases, generations or import
receipts. Expected member identity stays separate from observed export identity.
Conflicting bindings roll back the whole page. Creation closure rejects any
unenrolled canonical candidate. A rolling-only deletion trigger retains the owner
so deleting a member cannot remove it from that census. Its nonblocking campaign
lock orders deletion against campaign start; it inserts no retained owner outside
rolling mode. New creations are covered by the insert trigger above.

The seal covers an immutable `baseline` subset. Discovery and canonical
enrollment after creation closure produce `late` rows, without changing the original
hash/count or cursor. A late row never permits legacy admission merely because it
exists, including discoveries before the first baseline seal page. The source still needs its exact frozen disposition; conflicting/nonempty
sources cannot be relabeled empty or merged into an active Postgres owner.
Encrypted legacy deletion payloads are not covered by the resource-table query;
release proof must separately account for those runtime identities. Enrollment
alone proves neither empty source nor completed member handoff.

`next_object` persists one selected source before any local barrier can close.
Concurrent operators and lost reservation replies keep that source selected even
if an earlier late ID appears. It advances only after a terminal source receipt and activation of its expected
or observed member, if any. Source reads, member transitions and
empty imports/activation reject a different selection; the pointer has no expiry. Polling an
unfinished selection uses a single read-only statement without the campaign lock;
every source effect rechecks it, so stale hints can only fail. Actual selection
changes take a short exclusive transaction. Baseline work precedes late work.

Ordinary ensure-processing retries drive one bounded migration continuation when
Postgres reports draining or a legacy attempt returns retry during quiescence.
The capability flag must be enabled and the campaign closed/sealed. The Worker
enrolls the caller's deterministic source before obtaining a stub. Repeated
exact enrollment is acknowledged from a read-only statement snapshot; it does
not acquire the campaign lock or grant execution authority. New/conflicting
bindings still enter the existing transaction and validation path.

`select_first_use` resumes an unfinished durable selection or selects only the
caller's pending/late source. It cannot start the next legacy baseline member
after an operator canary. Every effect still validates current selection. The
continuation uses the same deterministic token, frozen exports and activation
as the operator. All its external steps share the original request deadline;
a late acknowledgement cannot start the next step after timeout. The existing
mailbox/Temporal retry owner requests the next continuation, and a subsequent
request re-reads ownership before starting Postgres. No second scheduler or
fleet enumeration runs in this path. Earlier paused sources resume before the
caller's source, preserving one planned handoff at a time.

The operator derives a stable token from namespace, object and member identity.
It polls checkpoint/freeze progress within the same bounded run, avoiding workflow
queue/install time during the pause. A readiness hold leaves that source live.
Recovery verifies serving identity and resumes the selected source before
unrelated enrollment or provider-list work. Final provider scans register unknown
late sources and report pending; final checks also repeat canonical enrollment
and selection before claiming completion. The sealed baseline remains unchanged.

`apps/cloudflare/scripts/runtime-migration.cli.ts` is the protected hosted
entrypoint. It accepts only private Murph Cloud main execution and uses that
environment's existing Cloudflare API credential and callback-signing key.
Inventory mode is read-only and outputs only count, hash and serving version.
Migration mode defaults to one source object, up to 1000 continuations and a
ten-minute work window. The object budget is checked before starting a different
source, so a canary can finish all pages and activate in one run. A pending or
failed result after quiescence requires same-source roll-forward recovery; the
work window is not a guarantee of member-pause duration. The hosted entrypoint
and canonical rolling campaign reject namespace finalization. Successful member
handoffs activate independently; completing them leaves the gate rolling with
explicit Postgres owners and the guarded namespace retained. Each control request has a fresh
signature over its method, path and exact body; the existing OIDC path remains
supported. No production credentials or raw inventories belong in local output.

The supported member continuation is an authenticated `advance_member` command
bound to an exact namespace, Worker version, object ID, member ID and migration
token. It conditionally closes local starts/deletion, checkpoints the exact
active attempt, proves its completion and stop, exports bounded frozen pages,
and activates the member. Incoming work stays durably queued. Preparation that
finds old direct-PUT capabilities or unsupported active code leaves legacy live.
A committed or ambiguous freeze requires same-token roll-forward recovery.

Deletion admitted before local closure must settle before source reservation.
Deletion after closure retains its canonical cleanup receipt and retries; it
cannot clear the frozen source. Empty-object migration closes callbacks, waits
for admitted work and rechecks emptiness before persisting a freeze. It exports
four hashed empty pages without constructing a runner or initializing SQL.
Account for empty and deleted/resource-only objects as well as active members.

Legacy source access records durable materialization intent before obtaining a
stub. The source rechecks registration on activation before ordinary RPCs can
initialize storage. Provider discovery and these intents form one inventory;
closing creation preserves registered legacy execution while preventing new
unregistered sources. A missing source after closure remains unresolved; an inventory omission is not
proof of emptiness. Source resolution never activates an empty member implicitly.
A stale route returns retry rather than trying another backend in the same
operation. Seal the baseline only after reconciling discovery with the
closed creation boundary and proving compatible serving-version convergence;
retain later arrivals separately for exact disposition.

After an exact empty source has completed its frozen export, `advance_empty`
calls canonical `activate_empty` for that selected source. It accepts only idle,
generation-zero identities without a migration or target and with exactly one
completed, bound empty-source receipt. No receipt is an unresolved source, not
permission to activate. Ownership and an encrypted maintenance wake commit
together; deleted members receive no wake. The ordinary migration callback
signals that committed wake immediately; mailbox recovery owns lost signals.
Activation does not wait for unrelated sources. Selection remains with the empty
source until its expected member is Postgres; concurrent and lost-response
retries return the same wake. Physical-only empty objects need no member owner.
`settle_unmaterialized` is retained as a completion audit only: it checks source
receipts and remaining owners without changing authority or creating wakes.
The rolling path cannot switch the global default: complete provider scans do
not prove an old caller cannot create another object.

Managed checkpoint uploads use an exact, durably admitted multipart upload ID.
Trusted completion seals the upload and streams the stored encrypted bytes to
verify size and SHA-256 before canonical publication. Unknown completion/abort
outcomes retain the obligation. Old direct-PUT capabilities still need their
full drain; negotiation of the new path does not revoke them. Schema 21 protects
managed legacy receipts from older writers. Every serving version must support
those receipts and the new quiescence record before they can be enabled.

Release acceptance requires complete canonical-member and known-source accounting,
no remaining legacy execution ownership, measured member handoffs and unrelated
member latency, correct resumed cold/warm replies, mailbox continuity, effect
receipts, cleanup, consent and deletion. Local tests establish only their tested
boundaries. Do not treat a skipped member, a timer, or imported metadata as a
completed handoff. Retain the fixed namespace and receipts during the campaign;
removal and any rollback require their own authorized operational action.

Inventory uses Cloudflare's [namespace list](https://developers.cloudflare.com/api/resources/durable_objects/subresources/namespaces/methods/list/),
[object list](https://developers.cloudflare.com/api/resources/durable_objects/subresources/namespaces/subresources/objects/methods/list/),
and [serving deployment](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/deployments/methods/list/)
APIs. Counts/hashes and operation phases are suitable evidence; raw object or
member inventories and resource rows remain private.
