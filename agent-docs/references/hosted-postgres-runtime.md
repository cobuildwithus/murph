# Hosted Postgres runtime ownership

## Authority and activation

`HostedRuntimeOwner` in Web's primary Postgres database owns member execution
admission. The durable `HostedRuntimeCutover` gate selects `legacy`, `draining`,
or `postgres`; `HOSTED_RUNTIME_POSTGRES_ENABLED` selects the deployed Worker
adapter. Both must agree before execution starts. The flag defaults to false.
A flag mismatch stops admission; it never falls back to another owner after
the gate leaves `legacy`.

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
replica refs protect retained objects from orphan deletion. Existing private
image capability expiry and the R2 lifecycle policy remain the expiry owner.

R2 contracts: [multipart upload and abort](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/),
[error codes](https://developers.cloudflare.com/r2/api/error-codes/), and
[strong consistency](https://developers.cloudflare.com/r2/reference/consistency/).
Strong delete consistency alone does not cancel a concurrent write.

## Finite fleet cutover

Production activation is a separate authorized operation, never a consequence of
merging this code or toggling the Worker flag. Keep the namespace and migration
receipts through rollback verification. Do not deploy an older legacy writer
after freezing: SQLite schema 20 rejects writers below that floor.

1. Apply the runtime owner, resource, legacy-import, and upload-recovery schema
   migrations. Deploy compatible Web readers and Worker code with the flag false.
2. Prepare the private deploy workflow to forward the flag through config
   rendering, validation, and deployment. In a separately authorized cutover,
   deploy the flag-enabled Worker and verify one exact version serves 100%.
   Its mismatch with the legacy gate intentionally pauses fresh admission.
3. In the authorized hosted operator context, import
   `migrateHostedLegacyRuntime` from `apps/cloudflare/scripts/runtime-migration.ts`.
   Supply the account, script, exact Worker version, Worker HTTPS origin, a
   Cloudflare inventory credential in memory, and fresh Vercel OIDC headers for
   each call. Invoke with `activate: false`. Never put credentials in arguments,
   artifacts, or local environment files.
4. The helper inventories the actual SQLite UserRunner namespace, including
   dormant, deleted-member, empty, and resource-only objects. It sets the durable
   gate to `draining`, seals an ordered inventory hash, and freezes each object.
   Freeze closes RPC admission before waiting for admitted work, repeatedly
   stops the exact target, proves existing capability drains, and removes alarms.
   Unknown state or stop outcomes keep the object closed and activation blocked.
5. Export/import uses bounded 50-record pages, a one-MiB page limit, content
   hashes, and durable cursors. It transfers resources and generation high-water
   only. It never imports active attempts, provider tokens, or live authority.
   Lost responses resume from committed receipts; changed frozen content fails.
   Rerun the same version-bound import while drains remain held.
6. After all imports finish, explicitly invoke the same helper with
   `activate: true`. It repeats deployment and full namespace inventory checks.
   Web activates only if every registered object completed, no target remains
   active, and the final inventory hash/count match. Never reset the gate to
   legacy. An unexpected deployment or inventory change requires a reviewed
   recovery; changing the recorded identity to bypass the gate is unsupported.
7. Verify cold and warm replies, typing-before-send, checkpoint publication,
   managed usage denial, consent stop, resource recovery, and deletion on the
   activated deployment. Observe metadata only. Roll forward with compatible
   readers if recovery is needed; removal of the frozen namespace is a later
   separately reviewed change.

Inventory uses Cloudflare's [namespace list](https://developers.cloudflare.com/api/resources/durable_objects/subresources/namespaces/methods/list/),
[object list](https://developers.cloudflare.com/api/resources/durable_objects/subresources/namespaces/subresources/objects/methods/list/),
and [serving deployment](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/deployments/methods/list/)
APIs. Counts/hashes and operation phases are suitable evidence; raw object or
member inventories and resource rows remain private.
