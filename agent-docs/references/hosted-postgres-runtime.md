# Hosted Postgres runtime ownership

## Postgres-only authority

`HostedRuntimeOwner` in Web's primary Postgres database is the sole member
execution authority. Worker processing, callbacks, resources and user-control
routes use it directly. Native `RunnerContainer` objects own execution evidence;
Temporal remains the pointer-only scheduler and retry owner. No campaign gate,
legacy namespace selection, discovery, materialization or import is executable.

The production migration and authorized UserRunner namespace deletion completed
on 2026-09-17; its immutable execution record is
[the completed cutover plan](../exec-plans/completed/2026-09-15-rolling-runtime-cutover.md).
The owner confirmed terminal fleet and import state on 2026-11-02. Keep ordered
Wrangler class migrations, including the original creation and `v10` deletion.
This removal does not delete another environment's namespace or storage.
An environment with unfinished legacy objects needs a compatible historical
migration release before using this Postgres-only release.

### Deployment compatibility

The fixed pre-removal baseline is `5530387031d90de8bc713e749bd10216e0ffa07f`.
Its Worker `runtime-owner-client.ts` sends signed POST commands to
`/api/internal/hosted-runtime/owner`: processing claims, native launch preparation,
completion, write-fence authorization, lifecycle reconciliation and user control.
`runtime-resource-client.ts` sends snapshot commands to
`/api/internal/hosted-runtime/resources`, replica admission/settlement to
`/api/internal/hosted-runtime/replica-put`, media commands to
`/api/internal/hosted-runtime/media`, and orphan receipts to
`/api/internal/hosted-runtime/orphans`. Neither it nor the runner calls the
removed `/api/internal/hosted-runtime/migration` or `resolve_legacy` operation.
The Worker migration operator already returns 404 at this baseline.

Base Web dispatches through the existing hosted control client to Worker
ensure-processing, user control and resource purge. Its migration implementation
uses database commands, crypto preparation and a post-commit Temporal signal;
it does not make a normal-operation migration RPC to Worker or runner. The
removed endpoint has no base Worker/runner caller, even outside normal operation.
The unchanged callback registry and virtual-host forwarding retain current
runner callbacks. Provider requests retain the native controller receipt;
`authorize_provider` and exact Web callback authority remain supported.

Owner, snapshot and media responses keep the terminal `cutover: "postgres"`
field because base Worker parsers require it. New readers accept that same
terminal response from base Web at the confirmed production phase. Old usage
readers default an absent meter-source field to `murph`; new readers ignore
that obsolete field from old runners and saved usage records. No producer
changes usage identity, price, amount, allowance attribution or token counts.
Thus Web, Worker and warm runner may deploy in either order from this baseline;
normal Web-first deployment is safe. No coordinated rollout or database change
is needed. This does not authorize rollback to an unfinished migration release.

Migration activation used ordinary `runtime.maintenance-requested` mailbox
items, which still run through the maintenance owner. Other retired mailbox
kinds retain `HOSTED_RETIRED_MAILBOX_KINDS` and `skip-retired-mailbox-item` handling.
Existing encrypted snapshot references, orphan rows and upload drains remain
owned by resource cleanup; deleting the importer does not delete their cleanup.
Native DO receipt/provider-context compatibility is independent of the finished
legacy-to-Postgres campaign and remains intact.

### Deferred schema contract cleanup

No schema object is dropped in this release. No dedicated enum exists. All
column defaults and NOT NULL constraints remain. Retained objects are:

- `hosted_runtime_cutover`, all columns (`id`, `phase`, `namespace_id`,
  `worker_version`, `inventory_after`, `inventory_hash`, `inventory_count`,
  `inventory_sealed_at`, `selected_object_id`, `namespace_probe_id`,
  `discovery_completed_at`, `creation_closed_at`, `activated_at`, `updated_at`),
  its primary key and `hosted_runtime_cutover_id_check` /
  `hosted_runtime_cutover_phase_check` constraints.
- `hosted_runtime_legacy_import`, all columns (`object_id`, `inventory_class`,
  `admitted_user_id`, `user_id`, `generation`, `next_cursor`, `last_cursor`,
  `last_hash`, `completed_at`), its primary key, unique indexes
  `hosted_runtime_legacy_import_user_id_key` and
  `hosted_runtime_legacy_import_admitted_user_id_key`, indexes
  `hosted_runtime_legacy_import_completed_at_object_id_idx` and
  `hosted_runtime_legacy_import_inventory_class_object_id_idx`, and
  `hosted_runtime_legacy_import_inventory_class_check`.
- `hosted_runtime_owner.migration_phase` and `.migration_id`, index
  `hosted_runtime_owner_migration_phase_user_id_idx`, and constraint
  `hosted_runtime_owner_migration_phase_check`. Current creation still writes
  constant `postgres` to preserve the historical diagnostic value; the existing
  database default is `legacy`. These fields grant no authority.
- `hosted_account_deletion_cleanup.runtime_migration_next_index` and index
  `hosted_cleanup_runtime_enrollment_idx`.
- Triggers `hosted_runtime_member_enrollment` and
  `hosted_runtime_deleted_member_enrollment` on `hosted_member`, with functions
  `enroll_hosted_runtime_member()` and `retain_hosted_runtime_member_for_migration()`;
  trigger `hosted_account_deletion_cleanup_runtime_enrollment_delete_guard` and
  function `prevent_unenrolled_runtime_cleanup_receipt_delete()`. They still take
  a short shared gate read lock and require its row for member creation/deletion;
  at production's terminal phase they do not enroll owners or block cleanup.
  Preserve that table and singleton until these triggers are removed.
- Eight `hosted_ai_usage` columns: `stripe_meter_source`, `stripe_meter_status`,
  `stripe_meter_attempt_count`, `stripe_meter_last_attempted_at`,
  `stripe_meter_next_attempt_at`, `stripe_metered_at`, `stripe_meter_identifier`,
  `stripe_meter_error`; index `hosted_ai_usage_stripe_meter_due_idx`. Source,
  status and attempts already default to `murph`, `skipped`, and zero; the other
  columns allow null. No new default or compatibility write is necessary.

Follow-up is a separate contract release under
[Hosted Web Contract Migrations](../../apps/web/prisma/contract-migrations/README.md).
First remove these Prisma models/fields/index declarations and the owner creation
constant, regenerate the client, and deploy that switched Web reader/writer.
Confirm Web, Worker and warm runner convergence and no supported rollback reader
needs them. Add a timestamped `contract-migrations/<id>/migration.sql` in that
later release, never a destructive predeploy Prisma migration. Drop the three
triggers, then their functions, then obsolete indexes/constraints/columns and the
two entire tables; preserve every live owner/resource/usage/allowance object.
Use explicit idempotent drops, not CASCADE. Do not alter historical migration SQL.

The existing workflow proves the exact current-main production deployment and
all aliases, waits the configured prior-function drain (300 seconds by default,
maximum 600), and repeats deployment proof before SQL. Its runner uses the
`hosted_web_contract_migrations` advisory transaction lock, 5-second lock timeout,
30-second statement timeout and checksum ledger `_hosted_web_contract_migration`.
A lock failure is retried through that workflow, never local production SQL.
After cleanup, the switched schema/client release is the rollback floor; restoring
an older reader requires re-expansion or a forward fix. No follow-up SQL is
included in this removal.

## Local initialization and fault controls

Fresh local runtime admission needs no application cutover initialization script.
Historical SQL migrations still create a singleton required by their retained
member triggers; keep it until contract cleanup. Prisma db-push environments
without those triggers need no singleton. Local E2E stale-attempt injection still requires an idle member
in a guarded loopback `murph_e2e_*` database, preserves the physical target and
increments generation. Test nudges use ordinary ensure-processing admission;
legacy alarm and run-until-idle controls remain unavailable.

## Request consolidation

Snapshot creation and media PUT, registration, deletion, and read admission use
resource commands' locked ownership checks without a preceding `authorize_effect`
HTTP call. Media GET sends `admit_read` with exact attempt/generation; Web checks
ownership and media lifetime in the same transaction before Worker crypto/storage
access. Snapshot abort relies on its final delete transaction; compatibility
checkpoint publication relies on the checkpoint transaction. Expired-session
cleanup preserves stale-owner rejections even when transport cleanup is best-effort.
Artifacts and private-media capability publication retain their separate checks.

Deploy Web with `admit_read` support before the Worker. The legacy `read` command
remains for older Workers that authorize separately. An older Web rejects the new
operation; there is no fallback, capability flag, or permission cache. Keep Web at
this version or newer while the new Worker runs. The media command owner removes
legacy `read` after older Worker versions are drained and excluded from rollback.
Warm containers keep their existing media HTTP protocol unchanged.

## Claim, launch, completion, and recovery

Runtime admission keeps the member lock before one composed eligibility read
(suspension, explicit consent withdrawal, and canonical direct or sponsored
access; retention still skips only the access requirement). Game-only group
access uses a bounded fallback that checks the source room's consent and
suspension before resolving its shared game's primary room. Claim freezes that
server-owned allowance beneficiary on the exact invocation. Existing claims and
launch retries retain it even if the game ends or its primary room changes;
only a released successor recomputes it. First launch preparation checks that
frozen beneficiary's allowance without resolving current sponsorship or game
routing again, and may only narrow the caller's usage permission. This prevents
a changed funding source from admitting against a different balance than the
one that will be charged. A denied preparation stays denied on retry.
Callback accounting uses the locked
owner's frozen beneficiary and retains it on the immutable usage row. Null
preserves ordinary source-member attribution, including historical rows. This
field never enters the runtime protocol or grants personal assistant access.
Claim, target selection and launch preparation return the owner proved by their
ownership transaction without rereading it after commit.

Best-effort Web direct wakes read a live-owner snapshot before each attempt.
The optional read is capped at 250 ms; hitting the cap omits admission and dispatches through the ordinary Worker path.
They supply existing admission only for a Postgres member that passes the same
default-mode eligibility predicate as claim and has a starting or active owner
with a container target and workspace version. Retention-only owners are not
wakeable by default-mode requests. This lookup uses one coherent owner/member
statement and canonical wire projection; it takes no locks and performs no writes.
An ordinary eligible member needs two sequential reads; the existing game-only
access fallback raises the maximum to five. At most two direct attempts each
use one connection at a time, without an interactive transaction or external I/O
inside database work. Existing database read retries remain bounded separately.

A live accepted wake skips the Worker-to-Web claim round trip. Otherwise Web
omits admission, including when the optional read fails, and the Worker claims
through Web after receipt as it does for Temporal. Cold and idle owners therefore
keep canonical admission after dispatch. Failed transport still leaves no
starting reservation, including when an idle owner retains a container target.
No compensating release is safe or necessary at the Web transport boundary.
Supplied stale generations follow the Worker's existing fenced recovery and
bounded claim loop; an uncertain wake or protected startup can still defer to
Temporal rather than immediately re-claiming.

The optional canonical admission response (`claimed` or `existing`) remains
supported for deployed Web callers. Only authenticated Web OIDC
callers can supply it; the Worker validates its member binding before container
work. Supplied snapshots never replace conditional database mutations or native
attempt/generation checks. Requests without admission are accepted by both old
and new Workers, so this caller change needs no coordinated Worker deployment.

Existing compatible owners are woken immediately after Postgres admission. The
native wake validates the exact attempt and generation; an accepted wake needs
no separate invocation receipt read. Unaccepted wakes still reconcile completed
receipts and prove an inactive fence before release. Retiring owners and
retention work that needs replacement follow the existing recovery path without
a wake. Unknown wake acknowledgments never authorize replacement by themselves.
Conflicting retention admission checks the existing native liveness seam before
deferring to another mode. An inactive owner enters the same receipt, startup
grace, and exact retirement/release path; active, mismatched, or unavailable
liveness keeps the conflict retry. A stale processing mode alone cannot strand
an invocation that failed before recording completion.

After exact completed-receipt and inactive-fence proof, recovery uses the existing
combined completion/release command. A stale acknowledgment requests fresh
canonical admission rather than assuming failure: another caller may already
have released the completed owner. An unusable retained target likewise permits
fresh admission after its existing exact retirement path. One ensure request
visits at most three admitted generations (completed owner, expired target,
fresh successor), within its existing command deadline. A repeated generation,
uncertain liveness or stop, or further contention returns the existing
three-second retry response. A claim denied by member admission (inactive,
suspended, or consent withdrawn) carries `blockedReason: "admission"`, and the
Worker retries five minutes out with reason `admission_blocked`. Member
activation and new inbound work signal Temporal directly, so the slower recheck
does not delay them. The reason is optional and parsed leniently: old Web omits
it (three-second retry) and old Workers ignore it, so either side may deploy
first. Successful warm wakes and fresh starts add no reads;
completion recovery removes the separate release callback. Each fresh-start
attempt retains its own bounded, overlapping workspace and native readiness
preparation; abandoned target reads are not execution authority.

The owner row has a monotonically increasing generation and one attempt. Its
phases are `idle -> starting -> active -> retiring -> idle`. Claim records an
allocation ID before an external allocation call. Target selection records the
immutable slot before native binding. Preparation binds workspace start version,
processing mode, encrypted inference settings, and managed-AI allowance once.
New invocations do not mint provider bearer credentials.
The workspace checkpoint compare-and-swap version is independent of generation.

Input preparation and native readiness overlap. The native slot submits the
existing `prepare_launch` command immediately before registering its durable
invocation receipt. That transaction binds invocation facts and verifies fresh
Web authority together; startup does not make a second `authorize_effect` call.
The existing readiness response advertises this capability. During mixed
Worker/controller deployments, callers of older controllers still prepare through
Web before the controller's authorization call; older callers remain supported.
Provider effects read their native controller receipt and binding.
Registered/completed receipts survive activation loss. A duplicate registration
cannot execute the attempt twice. An uncertain launch or stop retains the exact
target; age can schedule reconciliation but cannot authorize its replacement.
An admitted default claim takes priority over an unlaunched system-mailbox start.
Under the existing member and owner locks, claim changes that owner to `retiring`
only while its phase is `starting` and workspace version is null. This serializes
with `prepare_launch`: if launch preparation wins first, foreground wakes that
same child; if priority wins, stale background launch is rejected. The adapter
refreshes a supplied pre-launch background admission before using it.

Retirement cancels native readiness before waiting on the lifecycle lock, then
uses the existing exact target stop and release before fresh foreground admission.
Uncertain stop keeps ownership pinned. Background still reuses its bound warm
target or cold-starts independently of pristine standby inventory. Pool size and
allocation policy are unchanged. An empty foreground pool retains cold fallback;
preemption can discard partial background cold-start work in that case.

While a system-mailbox starting fence remains, foreground rechecks after at most
one second. Other startup waits keep the 30-second startup deadline. Expiry starts ordinary exact
retirement proof; it does not establish stoppedness or release authority.
Deploy cancellation-capable Cloudflare before the Web claim change. Old Web keeps
the startup fence until launch or expiry; old Cloudflare still retires safely but
can wait for preparation before stopping. Existing state and RPC shapes remain
compatible in both directions; rollback restores the older latency behavior.

Completion revokes ordinary effects and records completion before the adapter
releases ownership. Reuse additionally requires the exact native completed
receipt and either a settled native invocation or an inactive runtime fence
proved during reconciliation. Successful release retains the member's
warm target. Failed or ambiguous retirement requires exact native stop proof
before clearing its assignment. Bound slots never return to shared inventory.
Without a completed native invocation receipt, idle cleanup first checks native
status, active jobs, and the trusted conversation receipt deadline. Those local
vetoes need no owner callback; a future receipt deadline schedules cleanup directly
at that deadline. A bound completed native receipt still reconciles the canonical
owner before applying local warmth, because native completion does not prove
canonical acknowledgment. Otherwise only an eligible stop reconciles the owner.
A matching starting, active or retiring owner
protects an unprepared readiness-to-launch handoff, including after Durable Object
reactivation. Readiness establishes a missing native lifecycle schedule; persisted
schedules survive controller replacement. The controller constructor does not
recreate that deadline: an unbound standby can legitimately have none, and the
Containers SDK already restores its alarm and monitors a running container.
Failed reads preserve the existing scheduled
lifecycle recheck; they do not grant a new conversation lease. Cleanup rechecks
native status, health, and interaction fencing after the bounded control read,
which runs outside the lifecycle lock so arriving work does not wait on
control-plane latency. Explicit retirement
and its exact native stop proof remain the recovery owner. When the outer result
is lost after a completion callback, the existing container lifecycle recheck
also replays settled completion for a matching starting, active or warm retiring
owner, exact completed native receipt, and inactive native fence. This releases
drained owners without requiring new mailbox work. Active or unknown native
execution, stale receipts, and failed completion preserve the scheduled recheck.
Destruction requires a fresh canonical observation on a later lifecycle pass.
An exact registered invocation on a positively stopped process retires its target
without manufacturing completion; a missing receipt preserves an unprepared start.
The lifecycle schedule payload carries only the member and target for retrying
`target_retired` after this slot has durably retired, armed before that step. An
updated or stale response ends the retry, including across controller eviction.
On demand, a completed attempt with active, mismatched or unknown liveness keeps
its fence for 30 seconds from completion, or from start when Web has no completion.
It then enters the existing cold retirement path, which requires a confirmed
native retirement before release. That evidence never settles completion.
Without a future local receipt deadline, remote denial retains the existing
short lifecycle recheck.

A retiring owner is warm when `completedAt` is non-null and cold when it is
null. Read phase first because idle rows retain historical completion timestamps.
Destructive retirement clears `completedAt`, including on a warm row, and
completion cannot make a cold retirement reusable. This prevents a delayed stop
from interrupting a successor on the reused slot. Warm completion cannot veto
destruction: a completed child with a lost outer response can leave a
`transport_uncertain` operation that only stop or destroy clears. A row cannot
show a stop authorized by an older writer. Before trusting warm reuse across
this change, old Web writers and outstanding destructive authorizations must
drain, or affected assignments must drain cold. A request timeout does not prove
that a stop was cancelled.

The runtime completion callback and outer invocation result share the same
native receipt and Web `complete` command. Each stage uses one HTTP request for
conditional retirement and optional exact native-settlement release. Only the
successful final release schedules the advisory Temporal hint. The early callback
still reads the owner to route its
native receipt, and cannot release the still-running outer invocation. This read
also distinguishes already-completed released owners from superseded or
unconfirmed owners: native completion precedes canonical acknowledgment, and a
stale Web completion response contains no owner facts. The settled outer result
releases ownership before the HTTP response. Only an updated settled `complete`,
`release_completed`, or `release` schedules the advisory hint through Next `after`,
so neither its dependency loading nor its network wait delays acknowledgement.
Early completion and stale retries send no hint. No actionability read precedes
the hint: every ended attempt invalidates the workflow wait, while only a matching
attempt clears its accepted ownership. The hint has a two-second best-effort
budget; failure leaves
durable completion for native lifecycle or processing reconciliation. Lost
responses replay the same exact
identity and cannot retire or release a successor. Pending upload drains remain
owned by the existing release transaction.
Recovery from a lost completion acknowledgment uses that same settled `complete`
command after proving the exact completed receipt and inactive fence, replacing
the separate completion and release requests.

The container still awaits that recovery callback after the job and its response
finish. Health `activeJobCount` keeps counting it as lifetime work, so shutdown
drain, post-shutdown wake absence, idle cleanup, and the legacy wake probe are
unchanged. The child also reports `settlingCompletionCallbackCount`, and
admission excludes only those settling callbacks. A Worker readiness check
subtracts the settling count only when the child reports a valid integer between
zero and the total; an absent count uses the total, and a malformed count stays
busy. Admitting the next job beside a settling callback grants no authority: a
new attempt still needs canonical release, and the old callback cannot complete,
release, or retire its successor.

Deploy the additive Web completion consumer before the Worker producer. The
existing live Web protocol admission includes both early and settled command
witnesses parsed by the same reader as the ownership endpoint, and rejects
readers without that evidence before Worker activation. Legacy retirement,
release and owner-released requests remain supported during rollout. Warm
containers use the unchanged completion callback. Roll back the Worker before
removing the Web completion reader. Bounded phase-only failure metadata is
recorded before native stop, without granting or releasing authority.

## Transactions and effects

Ordinary runtime requests bind attempt/generation to their signed Web callback.
The Worker rejects caller-supplied authority query parameters and derives those
parameters from authenticated runtime headers. Web validates exact ownership and
the canonical mutation in the same transaction. Access, suspension, and health-data
consent are checked at claim admission, not repeated by ownership or provider
validation. A policy change blocks new admission; already admitted work may finish
until completion or the existing retirement/shutdown path ends its ownership.
The external retention tick retries an interrupted consent stop.
This is not an immediate-cancellation guarantee. Deleted members remain blocked;
their retained owner rows exist only for cleanup.

Provider effects use Cloudflare's platform-supplied container ID and class to
resolve the exact native controller. Its immutable member binding and registered
invocation receipt provide attempt/generation, admitted inference configuration,
and initial spending allowance. Pending or denied usage settlements remain a
native negative latch. Usage settlement resolves the same physical caller and
persists its exact native pending receipt before the first Web request. The signed
usage callback checks canonical ownership and updates the ledger; a failed Web
request cannot leave further managed spending authorized. The Worker retains operation policy and real provider
secrets; no request header, bearer token, or sentinel grants provider authority.
There is one controller RPC and no Web/Postgres authorization callback on this
ordinary path. Completion and native retirement revoke new provider calls;
already admitted effects may finish. Existing Live resource attachment keeps
its exact member/attempt/generation signature so cancellation can finish while
retiring. Postgres remains admission, canonical mutation, and billing authority.
A database-only retirement/deletion is not an instantaneous native stop: the
existing exact retirement path owns that boundary.

The receipt gains one nullable SQLite provider-context column. A predeployment
registered receipt imports missing context once from its exact Web owner, then
persists it through eviction; fresh launches write context before execution.
Remove this migration branch after old invocations drain. Web's old provider
reader and token-hash schema remain for deployed Workers during rollout, but
new Workers never call `authorize_provider`. Those old readers and exact-runtime
Web preflights use one committed-state SQL snapshot, without transaction locks
or an extra routing query. Internal signed Web callbacks keep exact ownership
checks; this change removes only the provider credential/callback path.

Lock order is member, runtime owner, then workspace/mailbox and
resource rows. Transactions contain bounded database work only, with five-second
transaction/admission limits. External allocation, container operations, provider
calls, and R2 writes run outside transactions.

Protected checkpoint recovery uses the same lock order. The operator job first
authenticates surviving sources, builds a candidate in private scratch and
round-trips its encrypted archive. A signed, member-bound recovery callback
stages its complete reference with the existing orphan cleanup owner before a
short-lived immutable upload. The job verifies the uploaded bytes before asking
Web to publish. Publication rechecks account admission, exact workspace version,
source snapshot and full Browser Vault reference, and terminal cleanup state.
It atomically retires the previous attempt and advances the checkpoint; it never
claims native stop or releases a target. The ordinary recheck adapter owns that
proof and subsequent execution. Recovery clears obsolete receipt-chain hints
and omits mailbox acknowledgment fields, preserving the mailbox counters and
pending items. Partial rebuilds preserve the original authenticated projection
as a labelled source document and use manual onboarding completion only when
explicitly instructed, leaving existing completed onboarding unchanged. Surviving
files remain byte-identical except the current audit and recovery event shards.
Their original byte prefixes must survive alongside two validated audit records
and the exact document event returned by the canonical import owner. The event
proof stays private and is excluded from the emitted summary. The encrypted replica read bound includes base64/envelope overhead
above the supported plaintext maximum. Partial recovery does not claim the
missing canonical files were restored.
Deploy the Web recovery reader before enabling protected recovery workflow modes.

Canonical publication locks return the current row and read member existence
from the member lock itself. These mutations retain three ordered lock queries.
External-effect and signed callback preflights use the same single committed-state
snapshot instead: their former locks ended before the handler or provider I/O
and could not make subsequent work atomic with revocation. Callback handlers
that publish canonical state still check ownership inside their own transaction.
An already admitted in-flight effect may finish; a read
after committed retirement or deletion is denied. Generations and workspace
versions retain native bigint precision. Deleted members remain unauthorized
even when cleanup retains their owner row.

The native usage-settlement receipt is a negative latch: pending or denied
settlement blocks managed provider access. Only an explicit allowance response
clears that report's pending latch, and it never clears a denial. An unknown Web
outcome durably denies the report before Web is told to revoke the attempt, so a
replay settles the ledger once without reopening that generation. The next
registered generation gets fresh admission. A settlement interrupted before that
denial leaves the report pending and the Worker issues no revoke, so a replay can
still settle it. Eviction or an unknown response cannot grant access. Postgres
retains the canonical usage and credit ledger.

## Uploads and deletion

Snapshot upload sessions, independent PUT drains, terminal media descriptors,
and typed orphan candidates live in Postgres. These obligations have no member
foreign key so account deletion cannot erase physical cleanup requirements.
Snapshot sessions retain existing presign admission and capability-drain policy;
fresh final admission precedes returning a presigned capability.

Current snapshot producers do not send handoff heartbeats or completion markers.
A session expires after sixty minutes; unaccepted resources first become cleanup
candidates after sixty-five. Independent pending upload receipts protect writes,
current workspace refs protect committed archives, and publication rejects a
retired ref under the same owner locks as cleanup. Expired completion can only
acknowledge a matching already-current checkpoint, never publish new bytes.
Session replacement does not use heartbeat or completion state. The legacy
heartbeat/completion commands and fields remain accepted until older Workers and
warm containers drain; their timestamps are compatibility data, not cleanup or
execution authority. No schema migration or coordinated rollout is required.

Managed completion reads both its session and immutable upload receipt through
the existing `snapshot_managed_read` command. It validates their exact identity
and admitted bytes locally, completes/verifies the existing R2 upload, and settles
that exact receipt even after revocation. The final checkpoint transaction owns
fresh attempt/generation admission, workspace CAS and resource-retirement checks;
normal completion has no additional standalone owner-read RPCs. Exceptional
cleanup retains its exact-session checks. Snapshot start shares the configured
commit deadline across request and response decoding, without a separate
heartbeat-derived six-second cap.

Accepted v2 workspace snapshots retain their encrypted R2 object and complete
authenticated snapshot reference, including the wrapped data key, for up to seven
days from archive creation. The archive's explicit inbox/media retention wake
caps this window so backup retention cannot extend expiring content. Missing
retention evidence grants only the existing orphan grace. The first complete
reference fixes that archive's `recovery_until` deadline; repeated refs and
key-only records cannot renew it. `cleanup_at` remains the retry schedule, so
deferring deletion of a current snapshot cannot renew its recovery deadline
after replacement. The existing orphan row owns this recovery history;
no additional scheduler or plaintext backup is created. Key-only session and
adapter cleanup records preserve that reference and cannot shorten its deadline.
Unaccepted uploads and ordinary replica orphans retain the 65-minute grace.
After namespace validation, physical replica cleanup deletes the root and its
finite sibling set in one R2 batch operation so serial binding round trips do
not exhaust the Web control deadline. Provider rejection remains a failed purge;
Web records purge acknowledgement only after the deletion request succeeds.
The existing bounded cleanup sweep retires expired, non-current snapshots under
the same owner/publication locks. Account deletion still drains writes and
deletes the entire member snapshot namespace without waiting seven days.

The runner rejects a replacement archive plan without a nonempty regular
canonical `vault.json` file before building or uploading it. Enumeration and
archive validation independently reject included files disappearing during the
scan or archive write. First bootstrap without an earlier snapshot remains
supported. These guards do not assert that every historical record is present;
the retained encrypted checkpoints provide the recovery window for other
integrity failures. Recovery must validate canonical coverage, preserve its
sources, and fence the workspace update; a Browser Vault projection alone is
not a complete canonical backup.

Worker-owned media, private images, and each replica shard use recoverable R2
multipart uploads. An empty upload is created first; its exact object key and
upload ID are admitted in Postgres before sending encrypted bytes. Each physical
write has a separate receipt. Completion or confirmed abort releases that
receipt. An unknown completion followed by an unknown abort leaves it pending.
Stopping a runtime never converts a multipart receipt into a timed drain.

Browser Vault replica refreshes allocate their fixed 36 empty uploads with at
most four R2 operations in flight, then admit all exact upload IDs in one Web
callback before sending bytes. One root orphan row still owns the family, and
one receipt per physical upload survives independently. Admission uses one
transaction with bounded database operations, including one set-based receipt
insert; settlement uses one set-based update. No R2 or crypto work occurs inside either transaction. The outer
non-multipart receipt and preliminary ownership callback are unnecessary because
batch admission performs the same live owner and resource-retirement checks.
The Worker drains every started upload before one bounded settlement callback;
only completed or confirmed-aborted identities enter it. Unknown completion or
abort remains pending, and an uncertain admission response sends no bytes.
A previously used identity rejects the entire admission batch. The deployed
single-object commands remain accepted during Web-first rollout. The existing
live Web protocol admission probe exercises both full-size batch parsers before
a new Worker deploy; the rollback floor keeps that Web consumer until all batch
producers have been reverted and converged.

The existing external-retention cron runs at minutes 2, 7, …, 57 of each hour
(`2-59/5 * * * *`). Its runtime-resource phase retains a 50-orphan selection
limit and cooperative 25-second budget. Twelve opportunities per hour remove
the hourly 50-candidate capacity ceiling without increasing work within a run.
The ideal ceiling is 600 orphan selections per hour; protected candidates,
provider delays, upload recovery, and preceding cleanup owners reduce actual
throughput. Check overdue unprotected candidates and created-versus-purged
counts over matched windows after deployment.

Account deletion and expired-computer cleanup share this cron and keep their
existing due-time, lease, state-claim and retry guards. Consent stop redrive runs
first, selecting up to 8 explicitly revoked members with a non-idle owner or
retained target for the same signed reconciliation, without normal processing
eligibility. The offset avoids other retention jobs' nominal start minutes;
it does not serialize invocations.
[Vercel cron concurrency](https://vercel.com/docs/cron-jobs/manage-cron-jobs)
and the existing exact-target/idempotent deletion contracts still apply.
Grace periods, reference protection, write fences and per-run bounds are unchanged.

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

Hosted-local snapshot multipart operations use the existing explicitly enabled
S3 control endpoint for allocation, completion, verification and deletion, so
they share MinIO with native presigned uploads. Wrangler's R2 emulator is a
separate store. Other local object classes retain their existing bindings;
production retains its original R2 binding. SigV4 query ordering compares URI-
encoded keys and values without locale collation, including multipart fields.

R2 contracts: [multipart upload and abort](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/),
[error codes](https://developers.cloudflare.com/r2/api/error-codes/), and
[strong consistency](https://developers.cloudflare.com/r2/reference/consistency/).
Strong delete consistency alone does not cancel a concurrent write.

## Processing diagnostics

The request-local Postgres ensure path emits the same detached
`runner.processing_finished` summary including stage,
outcome, elapsed time, observed fence and a finite retry reason. Telemetry cannot
delay the control response or change its result; orchestration correlation uses
the existing domain-separated hash rather than retaining the raw attempt ID.

Runtime log uploads still authenticate the signed callback, consume its nonce,
and check runtime ownership. When that admission rejects a stale owner with
`HOSTED_RUNTIME_OWNER_STALE` (409), the log route acknowledges the discarded
batch with `loggedCount: 0`. Bounded shutdown drains can leave uploads in flight
after retirement; these uploads cannot persist logs, request a recovery wake,
or schedule alerts. Other callback failures retain their existing error response,
and operational routes retain their stale-owner rejection.

### Reserved target retirement

A selected target can remain unbound when its bind RPC times out before commit.
Retirement validates the addressed immutable target and any persisted member,
then derives the effective claim from the local binding synchronously before
fencing admissions. A target with no persisted claim retires without one even
when the Postgres reservation supplies its allocation claim. Bound targets
still reject a mismatched claim or member. Failed native destruction leaves the
slot retiring for the existing retry; delayed binds cannot resurrect it.

### Processing deadline and settled recovery

The processing command owns its deadline independently of the timeout for one
Web callback. Native readiness retains its 15-second bound inside the command;
Web owner callbacks retain their shorter per-request bound. An expired command
preserves uncertain ownership and cannot launch a detached successor.

After exact native retirement and an acknowledged canonical release, processing
uses the existing bounded admission loop immediately. Failed or uncertain
retirement/release still retries; elapsed time alone never proves stoppedness.
