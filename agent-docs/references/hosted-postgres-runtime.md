# Hosted Postgres runtime ownership

## Authority and completed cutover

`HostedRuntimeOwner` in Web's primary Postgres database owns member execution
admission. Worker processing, callbacks, resources, and user-control routes call
that owner directly. Native `RunnerContainer` objects own execution evidence;
Temporal remains the pointer-only scheduler and retry owner. A database whose
migration gate is not `postgres` cannot start execution through this release.

The production migration and authorized UserRunner namespace deletion completed
on 2026-09-17. The [completed execution record](../exec-plans/completed/2026-09-15-rolling-runtime-cutover.md)
retains the census, release identities, smoke results, and post-deploy evidence.
The coordinator implementation, source export/freeze bridge, migration operator,
checkpoint RPCs, and one-time atomic deletion deployment path have been removed.
Neither production nor local Worker configuration binds `USER_RUNNER`.

Keep the ordered Wrangler migration history, including the original class
creation and `v10` deletion. Keep canonical Postgres migration receipts, schemas,
and terminal gate guards: removing source machinery does not reopen legacy
execution or erase accounting. Historical `legacy`, `draining`, and `rolling`
phases describe pre-retirement releases, not an available migration path in this
release. An unmigrated isolated database must be migrated with a compatible
historical release or explicitly reset before using current code.

Ordinary deployments use version upload and activation. Cloudflare cannot apply
a pending class migration through `versions upload`; another environment that
still owns legacy objects requires a separately reviewed migration/deletion
operation. Production retirement does not authorize deleting rehearsal data.
Cloudflare [class deletion migrations](https://developers.cloudflare.com/durable-objects/reference/durable-object-class-migrations-legacy/)
permanently erase the affected namespace. Never restore the retired class or
reopen legacy authority as a source rollback.

## Local initialization and fault controls

A fresh local schema starts with the `postgres` gate. Initialization preserves an
existing gate; it rejects a legacy database with instructions to complete its
migration on the preceding release or explicitly reset that isolated local stack.
Empty SQL owner tables do not prove a legacy namespace is empty.

Local E2E stale-attempt injection writes the canonical owner only in a guarded,
loopback `murph_e2e_*` database. It requires an idle Postgres member, preserves
any retained physical target, and increments its generation. Native fault
controls resolve the target from that owner. Test nudges use ordinary
`ensure-processing` admission and wait for acceptance before polling status;
retired legacy alarm and run-until-idle HTTP controls are unavailable.

## Claim, launch, completion, and recovery

The ensure-processing request accepts an optional canonical Postgres admission
response (`claimed` or `existing`). Only authenticated Web OIDC callers can
supply it; the Worker validates its member binding before container work. Web
can run its existing claim command locally and carry the result to the Worker,
removing the initial Worker-to-Web callback. Requests without admission still
claim through Web, including the separately deployed Temporal caller. Completion
recovery still claims successors through Web; supplied snapshots never replace
conditional database mutations or native attempt/generation checks.

Deploy the accepting Worker before enabling Web to send admission. Old Web and
Temporal callers remain supported by the new Worker. New Web is incompatible
with an older strict Worker parser. Roll back Web and let it converge before
rolling Worker below this reader floor. Publish reader and producer in separate
PRs because Web deploys independently on merge. No protocol flag or cached
admission is needed. Web must obtain a fresh snapshot for each direct retry.

Existing compatible owners are woken immediately after Postgres admission. The
native wake validates the exact attempt and generation; an accepted wake needs
no separate invocation receipt read. Unaccepted wakes still reconcile completed
receipts and prove an inactive fence before release. Retiring owners and
retention work that needs replacement follow the existing recovery path without
a wake. Unknown wake acknowledgments never authorize replacement by themselves.

The owner row has a monotonically increasing generation and one attempt. Its
phases are `idle -> starting -> active -> retiring -> idle`. Claim records an
allocation ID before an external allocation call. Target selection records the
immutable slot before native binding. Preparation binds workspace start version,
processing mode, the provider-token hash, encrypted inference settings, and
managed-AI allowance once. The opaque provider token travels only in the job.
The workspace checkpoint compare-and-swap version is independent of generation.

Input preparation and native readiness overlap. The native slot submits the
existing `prepare_launch` command immediately before registering its durable
invocation receipt. That transaction binds invocation facts and verifies fresh
Web authority together; startup does not make a second `authorize_effect` call.
The existing readiness response advertises this capability. During mixed
Worker/controller deployments, callers of older controllers still prepare through
Web before the controller's authorization call; older callers remain supported.
Provider effects continue to require their own live authorization.
Registered/completed receipts survive activation loss. A duplicate registration
cannot execute the attempt twice. An uncertain launch or stop retains the exact
target; age can schedule reconciliation but cannot authorize its replacement.
While the existing starting fence is preserved, retry at its 30-second deadline
instead of polling every three seconds. An independent wake can still reach a
ready child sooner. Expiry starts the ordinary exact retirement proof; it does
not establish stoppedness or release authority.

Completion revokes ordinary effects and records completion before the adapter
releases ownership. Reuse additionally requires the exact native completed
receipt and either a settled native invocation or an inactive runtime fence
proved during reconciliation. Successful release retains the member's
warm target. Failed or ambiguous retirement requires exact native stop proof
before clearing its assignment. Bound slots never return to shared inventory.
Idle cleanup of a member-bound slot also reconciles this canonical owner before
stopping an otherwise empty child. A matching starting, active or retiring owner
protects the readiness-to-launch handoff, including after Durable Object
reactivation. Failed reads and incomplete cutover preserve the existing scheduled
lifecycle recheck; they do not grant a new conversation lease. Cleanup rechecks
native interaction fencing after the bounded control read, which runs outside
the lifecycle lock so arriving work does not wait on control-plane latency. Explicit retirement
and its exact native stop proof remain the recovery owner.

The runtime completion callback and outer invocation result share the same
native receipt and Web `complete` command. Each stage uses one HTTP request for
conditional retirement, optional exact native-settlement release, and the
advisory Temporal hint. The early callback still reads the owner to route its
native receipt, and cannot release the still-running outer invocation. The
settled outer result releases ownership before signaling outside the database
transactions. The hint has a two-second best-effort budget; failure leaves
durable completion for the normal recheck. Lost responses replay the same exact
identity and cannot retire or release a successor. Pending upload drains remain
owned by the existing release transaction.
Recovery from a lost completion acknowledgment uses that same settled `complete`
command after proving the exact completed receipt and inactive fence, replacing
the separate completion and release requests.

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
This is not an immediate-cancellation guarantee. Deleted members remain blocked;
their retained owner rows exist only for cleanup.

Provider effects still authenticate their exact runtime identity or credential,
apply provider operation policy, and enforce managed spending limits. The same
Web authorization response selects Postgres or explicitly legacy routing; no
separate backend-discovery request precedes it. Draining, stale, or failed
Postgres authorization never falls back to legacy. No positive-allowance cache
or standalone UserRunner callback preflight is added. Deploy Web's combined
backend-selection/authorization response before its Worker consumer: older Web
rejects exact-header authorization for legacy members instead of returning their
backend. Existing Workers remain compatible with the new Web behavior.

Lock order is the cutover gate, member, runtime owner, then workspace/mailbox and
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

Owner locks return the current row, and callback/provider admission reads member
existence from the member lock itself. These paths use three ordered lock queries
in the completed Postgres phase, without separate owner/member rereads. Returned
generations and workspace versions retain native bigint precision. Deleted
members remain unauthorized even when cleanup retains their owner row.

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
transaction with nine database operations in the Postgres phase (at most 15
while the existing rolling cutover locks apply), including one set-based receipt
insert; settlement uses one set-based update under the existing cutover gate. No R2 or crypto work occurs inside either transaction. The outer
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
existing due-time, lease, state-claim and retry guards. The offset avoids other
retention jobs' nominal start minutes; it does not serialize invocations.
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

### Reserved target retirement

A selected target can remain unbound when its bind RPC times out before commit.
Retirement validates the addressed immutable target and any persisted member,
then derives the effective claim from the local binding synchronously before
fencing admissions. A target with no persisted claim retires without one even
when the Postgres reservation supplies its allocation claim. Bound targets
still reject a mismatched claim or member. Failed native destruction leaves the
slot retiring for the existing retry; delayed binds cannot resurrect it.
