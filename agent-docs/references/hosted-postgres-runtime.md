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
