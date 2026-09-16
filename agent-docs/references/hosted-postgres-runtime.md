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

`hosted-member-store.ts::createHostedMember` initializes an explicit Postgres
route for new personal and group runtime members during rolling/Postgres mode,
in the same transaction as creation. Existing missing routes never imply a new
member. The FK-free route survives deletion; a conflicting old owner cannot be
overwritten by creation. The creation path takes a nonblocking shared campaign
lock because some callers already hold identity/family locks; contention returns
a retryable setup error rather than waiting in an inverted lock order.

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
implementation is not yet a complete operational release: private workflow
review, composed creation-closure proof, rehearsal and final review are still
required. `migrateHostedLegacyRuntime` now starts a rolling campaign, reconciles
provider discovery with creation intents, closes legacy creation and seals the
ordered inventory. It never invokes the old fleet-draining path.

`next_object` selects the first source without a terminal empty disposition or
complete member activation. A completed import stays selected until its owner
is Postgres. Immutable inventory order and monotonic receipts keep concurrent
retries on the same source; the operator derives a stable member token from
namespace, object and member identity. The hosted driver polls checkpoint/freeze
progress on the selected source within the same bounded run, avoiding workflow
queue and install time during the pause. A readiness hold leaves that source live
and returns; it delays later handoffs. Other members keep running. Final provider scans
must be covered by the registered census; an unknown late object holds closure.

`apps/cloudflare/scripts/runtime-migration.cli.ts` is the protected hosted
entrypoint. It accepts only private Murph Cloud main execution and uses that
environment's existing Cloudflare API credential and callback-signing key.
Inventory mode is read-only and outputs only count, hash and serving version.
Migration mode defaults to one source object, up to 1000 continuations and a
ten-minute work window. The object budget is checked before starting a different
source, so a canary can finish all pages and activate in one run. A pending or
failed result after quiescence requires same-source roll-forward recovery; the
work window is not a guarantee of member-pause duration. `finalize` controls the
final campaign default switch, while successful
member handoffs activate independently. Each control request has a fresh
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
unregistered sources. A stale route returns retry rather than trying another
backend in the same operation. Seal only after reconciling discovery with the
closed creation boundary and proving compatible serving-version convergence.

After every sealed source has a terminal disposition, `settle_unmaterialized`
handles one remaining default owner per call. It accepts only idle, generation
zero identities without a migration or target and with no nonempty bound
source. Ownership and an encrypted maintenance wake commit together; deleted
members receive no wake. This accounts for lost first-use requests and admitted
but empty sources without inventing execution history. Existing mailbox recovery
owns a lost wake signal. Final campaign activation still independently rejects
any remaining legacy owner or incomplete source.

Managed checkpoint uploads use an exact, durably admitted multipart upload ID.
Trusted completion seals the upload and streams the stored encrypted bytes to
verify size and SHA-256 before canonical publication. Unknown completion/abort
outcomes retain the obligation. Old direct-PUT capabilities still need their
full drain; negotiation of the new path does not revoke them. Schema 21 protects
managed legacy receipts from older writers. Every serving version must support
those receipts and the new quiescence record before they can be enabled.

Release acceptance requires complete namespace and creation-intent accounting,
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
