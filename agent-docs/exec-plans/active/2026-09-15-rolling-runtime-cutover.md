# Rolling hosted runtime migration without a fleet pause

Status: active
Created: 2026-09-15
Updated: 2026-09-15

## Goal and invariants

Implement member-scoped migration, obtain passing final ReviewGPT and exact-head
CI, merge and deploy, and migrate every legacy object without a planned
fleet-wide admission pause. Preserve accepted work, canonical workspace state,
consent, deletion, effect receipts and resource obligations. Exactly one backend
admits each member's effects. Unknown launch, stop and effect outcomes never
grant replacement authority.

## Existing owners and proven gap

Extend Web's existing FK-free HostedRuntimeOwner; UserRunner remains the finite
legacy bridge. Keep native RunnerContainer execution and Temporal scheduling.
The global adapter switch, singleton draining gate, exclusive per-page gate lock
and fleet-wide activation predicate currently prevent rolling handoffs. The
operator stops at its first draining object. Upload capabilities outlive upload
completion; the current migration stop destroys rather than gracefully checkpoints.

## Decisions

- Explicit member migration state and operation identity; imported owner-row
  existence never activates execution. No dual writes or new runtime scheduler.
- One member-aware route decision with destination-side fencing for execution,
  canonical callbacks, provider effects, resources, native slots and user controls.
- Observational preparation followed by a conditional local readiness barrier.
  Preserve pending-operation accounting, repeated exact-target stop, frozen
  export hashes/cursors, resource tombstones and generation high-water.
- Graceful checkpoint before stopping a busy member; new work remains queued.
  Activation leaves a durable wake for the existing scheduler.
- Preserve upload deadlines. Implement a controlled checkpoint-upload path or
  equivalent proved mechanism for busy members; leaving them indefinitely on
  legacy does not complete the objective.
- Account for empty, deleted, resource-only and group objects. Close new legacy
  object creation separately from execution. Final closure permits active
  Postgres members and verifies no remaining legacy authority.
- Member-scoped locks and resumable recovery; no global exclusive lock per page.
  Freeze requires roll-forward recovery, never timeout-based rollback.
- Temporary compatibility is removable only after complete inventory accounting,
  Postgres activation and absence of legacy traffic.

## Product UX

Outcome: correct replies continue throughout the campaign; only a member's own
handoff may briefly defer queued input. Cover idle/busy personal members, groups,
new signups, consent/deletion and operator failure. Verify checkpoint continuity,
accepted-message replay, cold/warm replies, effect deduplication, cleanup and
unrelated-member admission. A sub-ten-minute target needs measured headroom;
passing a timer never substitutes for safe handoff evidence.

## Tasks

1. [in progress] Revalidate state; add explicit member migration contracts,
   schema, locks and readiness evidence.
2. [in progress] Implement all member routing, graceful/conditional handoff,
   controlled upload/drain behavior and durable activation wake.
3. [in progress] Implement hosted resumable operator, source discovery and creation
   barrier, new-member routing and full campaign closure.
4. [pending] Focused race/crash tests, typechecks and composed rehearsal.
5. [pending] Candidate/privacy/complexity review, owner docs, changelog decision,
   PR, green exact-head CI and final ReviewGPT.
6. [pending] Merge and compatible Web/schema/Worker deployment; verify serving
   versions and inactive campaign before canary.
7. [pending] Canary, full inventory migration including busy members and held
   obligations, and final live outcome verification.

## Verification

Use synthetic fixtures in artifacts; retain only aggregate content-free live
proof. Exercise stale routes, canonical transaction races, in-flight external
operations, new work, lost responses, imports, activation, consent and deletion.
Required final proof: deployed source/schema/configuration, complete namespace
accounting, zero legacy execution ownership, correct migrated cold/warm replies,
and no planned fleet pause. An operator success or green CI alone is insufficient.

## Progress

- Design consultation supports member-scoped migration and rejects unproved
  early transfer of unexpired direct-PUT capabilities.
- Implementation base: 810fba9d0890492712781e6362dc00489a555bb4.
- Isolated checkout; no production migration command has been run.
- Added member migration fields, mixed-mode route hints and transaction-level
  admission. Legacy callbacks retain their authenticated member identity.
  Cleanup selection filters migrated owners before the bounded batch limit.
- Added an authenticated exact-object inspection operation. Lazy runner
  construction avoids schema initialization during inspection; raw reads report
  active execution and upload obligations without starting recovery clocks.
  Unsupported dormant schemas are reported without mutation. Inspection is
  observational, not authorization to freeze or activate.
- Real Postgres proof covers partial import admission, same-member callback
  serialization, independent-member progress, missing-owner races and cleanup
  starvation. Existing owner and fleet-import Postgres tests also pass.
- Worker routing tests and Web, Worker and shared-contract typechecks pass.
  SQLite/RPC tests cover read-only inspection, exact-object authentication,
  contradictory resource identities, existing export and freeze behavior.
- Added an exact-member/attempt/generation graceful-checkpoint request to the
  container's existing shutdown path. Native port access does not start a
  stopped container; a missing or lost response remains unconfirmed. Acceptance
  is not checkpoint durability or native-stop evidence. The process now keeps
  its active-job count until its completion callback has settled, preventing a
  concurrent control response from exiting the process early.
- Added token-bound durable local quiescence. New starts return retry-later;
  current-attempt callbacks remain admitted. Closure waits for admitted launch
  RPCs before the operator can select a checkpoint target and survives object
  eviction. A failed storage write never acknowledges closure or reopens the
  in-memory gate. Final freeze still blocks all RPCs, settles tracked work and
  repeats the exact-target stop. Canonical member transitions and operator
  wiring for these primitives remain pending.
- Checkpoint/container and local barrier/inspection suites pass together: 319
  tests across four files. Worker and shared-contract typechecks and the
  complexity guard pass. These are local primitive proofs, not a completed
  handoff rehearsal or measured member-pause result.
- Implemented the managed-upload path for Postgres members. Containers negotiate
  support, stream one encrypted part directly to R2, and include the exact upload
  ID and ETag in the existing snapshot-completion request. The existing upload
  ledger records immutable byte identity before a part URL is returned, survives
  session replacement/deletion, and excludes direct-PUT capabilities for that
  same snapshot. Recovery can abort snapshot upload IDs through the existing
  resource purge endpoint. Old clients retain the direct path.
- Trusted completion seals the exact upload and streams the actual object through
  SHA-256 before acknowledging verification or canonical publication. It does
  not trust client metadata, ETags or multipart checksum formats. Lost completion
  replies require acknowledged abort/NoSuchUpload before readback; unknown aborts
  retain the durable obligation. This adds one storage read per new checkpoint;
  real R2 interoperability and latency still require composed rehearsal.
- Managed upload validation: 574 Worker tests and 31 real Postgres owner/resource
  tests pass. Web, Worker and shared-contract typechecks pass; complexity guard
  passes. The additive upload ledger migration is applied only to the isolated
  synthetic test database. Production remains unchanged.
- Extended controlled uploads to legacy members. Independent durable receipts
  survive current-session replacement. Managed/direct admission and cleanup
  share the existing consent mutex; exact abort precedes cleanup, member deletion
  and final freeze. Unknown aborts retain state. Read-only inspection counts
  pending receipts with bounded pages; frozen coverage rejects pending uploads.
  Schema 21 prevents older writers from ignoring these obligations; inspection
  accepts schema 20 without upgrading it. Compatible release convergence remains
  required before enabling managed legacy uploads.
- Legacy upload proof: 367 Worker tests across five focused files pass, including
  competing upload modes, duplicate allocations, current-session loss, ambiguous
  abort during deletion, terminal receipt retention, read-only paginated receipt
  inspection and legacy/Postgres owner routing. Worker and shared typechecks and
  the complexity guard pass. No production state was changed.
- Old direct capabilities must still drain while members remain live, before
  quiescence. Managed upload negotiation does not revoke previously issued URLs.
- Added canonical rolling campaign and token-bound member transitions. Each
  member reserves one exact inventory object, serializes against its callbacks,
  imports exact frozen pages, and activates independently. Member pages take a
  shared campaign lock; campaign closure permits migrated active executions.
  Import alone never activates routing. Wrong source, token and page identity
  fail closed. Empty-object handling and new-object closure remain pending.
- Activation commits an ordinary encrypted maintenance mailbox wake in the same
  transaction as backend ownership. Existing Temporal mailbox recovery owns
  missed signals; provider-capable crypto preparation stays outside the short
  database transaction. Deleted members transfer without creating a wake.
- Real Postgres proof passes: four new member migration tests plus the existing
  fleet migration test. It covers same-member callback serialization with an
  independently progressing member, complete import before activation, one wake
  across retries, deleted members and fleet closure during migrated execution.
  Web, Worker and shared typechecks and the complexity guard pass.
- Wired the authenticated exact-object member continuation: reserve canonical
  identity after conditionally closing local starts and deletion, request the exact active checkpoint,
  wait for completion, freeze, import one page per request and activate. Raw
  operator freeze/activation/import commands are rejected; only the source Worker
  supplies pages and transitions. Replaying activation also retries its existing
  wake signal after commit; durable mailbox recovery covers lost signal replies.
- Conditional readiness runs after admitted launches settle. Busy old containers
  must answer a non-mutating native GET capability probe before closure persists;
  old direct URLs and pending replica writes leave the member live. Rejected
  preflight can reopen only an unpersisted local barrier. Persisted closure never
  reopens. Final stop independently refuses an active attempt even after a
  checkpoint request was accepted. Native probes never auto-start containers.
- Controlled-byte verification now has a 60-second read deadline and cancels a
  stalled stream without granting verification or upload-settlement authority.
- Source proof: 349 tests across seven affected Worker files pass (including
  three operator transition-boundary cases); five real Postgres migration tests
  pass. Readiness/checkpoint/container, conditional closure and a resumable
  source-to-import continuation are covered. This remains local component and
  composed-source proof, not real R2 interop or a measured live member pause.
- Next implementation: empty-object migration, explicit new personal/group member
  ownership and legacy creation closure, then the authenticated hosted fleet
  operator. Busy pre-protocol processes remain live during readiness; release
  convergence and eventual completion of every held member must be proved in
  rehearsal and deployment. Do not mistake a skipped member for completion.
- Resolved the deletion race with failing-before/passing-after source tests.
  Read-only canonical observation precedes local closure; admitted deletion
  settles before readiness, and durable closure precedes canonical reservation.
  Deletion after closure retains the existing durable cleanup retry. Lost
  reservation replies preserve the barrier for exact-token recovery.
- Added exact-object empty migration. The barrier waits for admitted work and
  rechecks emptiness before persistence; a racing bind keeps its legacy runtime.
  Truly empty objects export four verified empty pages without constructing a
  runner or initializing SQL. Empty imports create no member execution owner.
- Verification for these changes: 25 Worker tests and five real Postgres tests
  pass; Worker, Web and shared typechecks and the complexity guard pass. Earlier
  deletion-focused proof also passes (40 Worker and four Postgres cases). These
  are local correctness checks; no production mutation or latency claim.
- Centralized member creation now assigns an explicit Postgres route in the
  creation transaction during rolling/Postgres mode. Personal identities, auth,
  referral/family signup and group containers all use this creation owner.
  Creation takes a nonblocking shared campaign lock: callers may already hold
  identity/family locks, so an exclusive transition yields retryable setup rather
  than an inverted lock wait. Deleted routes survive; conflicting owners cannot
  be overwritten; failed creation rolls back both records.
- Creation proof: eleven real Postgres cases cover route selection, transaction
  rollback, deletion, conflicting prior identity and campaign concurrency,
  including immediate retry during an exclusive transition. The affected signup
  suites were exercised; mock fixtures now include campaign reads while their
  canonical member lock-order assertions remain intact. Web typecheck passes.
- Creation/inventory closure still requires durable materialization intent before
  legacy object access, including ensure-processing, bound user routes, deletion,
  outbound callbacks and provider authorization. New-member routing alone does
  not cover older members' first use. The existing immutable inventory cannot be
  sealed while an unregistered legacy object can still materialize.
- Remaining before a final candidate: complete effect and
  control routing; creation/inventory closure; hosted
  operator; composed rehearsal; owner documentation and final review/CI. Keep
  the PR draft and the production campaign inactive until those are complete.
- Added durable legacy materialization intent before Worker source lookup and
  a source-side activation check before ordinary RPCs initialize storage. The
  provider census and admission intents share one ordered inventory. Creation
  closure preserves known legacy execution, rejects stale release admission,
  and routes an older member's previously unmaterialized first use to Postgres.
  Final inventory sealing rejects omissions and remains closed to new sources.
- Source admission races now return ordinary processing retry or HTTP 503 for
  user controls without calling a second backend. Worker typecheck and 21
  focused source-admission/processing/control tests pass.
- Added bounded settlement for default legacy owners left by lost first-use
  requests or completed empty imports. It requires a closed sealed census and
  all source dispositions, rejects prior generation/attempt/target authority,
  and commits one ordinary encrypted wake with activation. Existing mailbox
  recovery handles lost signals; deleted identities receive no wake. Concurrent
  settlement/retry proof and ordinary member import proof pass against isolated
  PostgreSQL: twelve tests across three files, including refusal to activate an
  empty receipt while creation remains open. Web and shared typechecks pass.
- Broader affected Worker verification passes: 507 tests across six files,
  including the HTTP route suite. The legacy operator's two regression tests
  pass; that operator still requires replacement for rolling migration. The
  campaign parser now separates campaign commands from object commands; shared
  typecheck, complexity guard and documentation drift checks pass.
- The hosted operator still needs durable one-at-a-time selection, resumable
  advancement and final accounting. Late empty objects from old Worker requests
  require composed serving-version/creation-closure proof before deployment;
  no production mutation or handoff timing claim has been made.
- Replaced the fleet-draining operator with a bounded rolling driver. It
  discovers provider objects, closes materialization, rescans and joins durable
  intents, verifies/resumes the inventory seal, advances exact source handoffs,
  settles unmaterialized owners and independently verifies final accounting.
- Ordered selection derives from existing source/activation receipts rather
  than a new lease. A completed import remains selected until its member is
  Postgres. Same-source retries use a deterministic token and cannot advance to
  a later member after a lost import/activation response. Pending readiness
  leaves the campaign live but delays later handoffs. Unknown late provider
  objects hold final closure instead of being silently omitted.
- Added the hosted CLI with read-only inventory default, bounded migration
  steps and aggregate output. It requires private Murph Cloud main execution;
  the private production environment has the required API and signing secret
  names (metadata inspected only). Signed control admission reuses existing
  method/path/body signatures and nonce replay protection alongside OIDC.
- Local proof: seven rolling-driver tests cover serial activation, intent-only
  sources, held readiness, restart after lost seal/import replies, bounded work
  and final inventory drift. Four CLI tests cover execution boundary, options,
  fresh signatures and aggregate-only output. Eleven Worker route/backpressure
  tests pass, including signed payload tampering and replay rejection. Four real
  Postgres handoff tests now prove ordered selection through activation. Worker,
  Web and shared typechecks pass; the complexity guard passes.
- Next: wire the protected private workflow, prove creation closure against
  late old-release requests and compose full handoff/R2/latency rehearsal. Final
  ReviewGPT, exact-head CI, merge, deployment and complete live migration remain
  required. The PR stays draft; no production mutation has been performed.

- Final operator route regression: 175 Worker tests across four files pass;
  Worker typecheck and documentation drift pass. The private workflow and
  late-old-request closure proof remain the next concrete work.

- Committed and pushed the rolling operator at d0af2d04d362. A fresh design
  consultation is reviewing exact-source creation closure, including late old
  requests and unknown sources; this is separate from final PR approval.
- Corrected hosted operator scheduling: a canary budgets one source rather than
  one page, and checkpoint/freeze waits poll that same source within a bounded
  run. Fourteen CLI/operator tests, Worker typecheck and complexity guard pass.
  The real tsx entrypoint loads and rejects local invocation before credentials.
- The private workflow is drafted in an isolated Murph Cloud checkout. It
  validates protected-main public ancestry, pins the source before dependency
  installation, serializes with Worker deployment, uses existing hosted-only
  credentials and defaults to aggregate inventory. Private verification/review
  and the public closure/rehearsal gates remain required before dispatch.

## Creation-closure consultation and remaining correction

The exact d0af2d04d362 design consultation completed with verified GPT-6 Pro
metadata and response SHA
`64b1902d33355c605c45e5cef74cbb625250bad32e58bf6c1c64e9d6170147be`.
It is not the final PR gate. Parent inspection accepts these concrete defects:

- Missing source rows and owner-only settlement do not prove remote absence.
  An old request can bypass new registration. Remove inferred-empty activation;
  require positive exact frozen-empty/import receipts and durable activation wakes.
- Canonical coverage is incomplete. Enumerate personal/group runtime members,
  retained owners and durable cleanup identities, deriving named object IDs in
  the Worker. Expected identity stays separate from the source's observed identity.
- New-member creation currently grants Postgres immediately. During unproved
  old-version overlap, enroll creation transactionally without granting either
  runtime authority, including older writers that bypass the new helper. A narrow
  database enrollment trigger can cover that writer boundary. First-use processing
  must progress exact-source retirement through existing retry ownership; do not
  leave future signups waiting for a one-off operator after the campaign finishes.
- A sealed provider list is not an exhaustive creation fence. Preserve its baseline
  hash/count, distinguish late sources on the existing ledger, and require terminal
  late dispositions. A late record is not permission to resume legacy execution.
  Nonempty/conflicting late sources need explicit recovery, never an empty label.
- Late enrollment must not change the selected source while its local barrier is
  durable but its canonical reservation has not acknowledged. Prove one planned
  paused member across concurrent selection, late insertion and lost replies;
  immutable baseline ordering alone will not prove this for a growing late set.
- Resume an already paused member before unrelated provider drift checks. This is
  fixed locally with failing-before/passing-after lost-import-reply plus drift
  proof; 15 operator/CLI tests, Worker typecheck and complexity pass.
- Member completion requires exact source receipts and committed Postgres ownership
  for the canonical cohort, with wakes where applicable. Keep the guarded legacy
  namespace for residual accounting; do not infer physical namespace retirement
  from repeated scans or a 100-percent deployment configuration. The private
  workflow now explicitly disables the global default flip. All members must still
  migrate, and new signups must remain functional: this is not a smaller rollout.
- Before leaving the campaign in rolling, support subsequent compatible releases
  without stranding pending/new-member retirement on the original Worker version.
  Preserve fixed namespace, source receipts, tokens and authority; do not solve
  release changes by clearing migration state or bypassing exact-source checks.

Private companion PR152 contains the protected workflow. Initial full private
verification passed, including 131 deployment-controller tests, coverage,
typecheck, build and built-worker checks. Its removal of the global flip has
passed Actionlint; full verification is running again. Required preliminary and
final ReviewGPT are running on the clean pushed private head. These private gates
cannot substitute for public completion, rehearsal or deployment evidence.

The public PR remains draft. Canonical enrollment, late-source recovery,
new-member first-use progress, release compatibility, composed rehearsal and
final review/CI remain required. No production mutation has occurred.

- Removed source-resolution activation based on non-discovery, including implicit
  activation from an empty receipt without its durable wake. Settlement now
  requires exactly one positive bound empty-source receipt. A real Postgres test
  fails before the fix (unknown source incorrectly becomes Postgres) and passes
  afterward. Eleven materialization/member migration tests and Web typecheck pass;
  operator drift recovery has 15 passing CLI/operator tests, Worker typecheck,
  complexity and documentation drift proof. Canonical enrollment is still pending.


## Transactional new-member enrollment

- Reproduced the older-writer gap with a real Postgres insert that bypasses the
  current creation helper: no owner was enrolled. The added database trigger now
  records `pending` in that same transaction during rolling mode. It shares the
  campaign lock with NOWAIT, survives member deletion, rolls back with creation,
  and rejects conflicting retained identities. Legacy and global Postgres mode
  continue deriving backend authority from the gate; no extra owner is needed.
- Removed immediate Postgres activation from the application creation helper.
  It only takes the early nonblocking campaign lock for the existing retryable
  signup error. Pending owners admit neither runtime before their exact source
  is retired; ordinary member and positive-empty handoff paths can advance them.
- Focused proof covers both current and older creators across campaign-start
  races, rollback, deletion and owner conflicts. Existing and pending member
  handoffs both preserve generation and append one durable wake. Worker tests
  exercise legacy, pending and quiescing entry phases through actual local
  freeze/export logic. Automatic first-use source enrollment/progress remains
  unfinished and is still a release blocker, not a completed signup journey.
- Found the draft's migration SQL had not been admitted by the production
  predeploy scanner. Verified its four flagged migrations are expansions: new
  defaulted phase fields, nullable verification metadata, and widened checks.
  Added narrowly named compatibility reasons; no SQL operation category was
  globally exempted. Predeploy still leaves the campaign legacy.
- Private companion final ReviewGPT passed at its exact pushed head; local full
  verification and exact-head CI passed. Its preliminary review is still running.
  Public completion, rehearsal, measured pause and production migration remain
  outstanding. No production mutation has occurred.

- Removed rolling namespace finalization from the public operator and CLI; the
  canonical Web command now rejects that global transition as well. Every exact
  member can still activate independently and keep serving with the gate rolling.
  Failing-before Postgres proof demonstrated the former global switch despite
  absence of physical namespace closure. The draining legacy protocol is separate.

- Final focused validation for this increment passed: 32 real Postgres tests
  across four migration/admission suites, 27 Worker/operator/CLI tests, 69
  production migration-guard tests, Web/Worker/shared typechecks, complexity and
  docs drift. The new migration was applied only to the isolated synthetic DB.
  Both old-writer enrollment and forbidden rolling finalization have recorded
  failing-before proof. The public PR remains draft with the release gaps above.


## Canonical source enrollment increment

The next correction derives bounded candidate pages from canonical members and
retained runtime owners/resources, excluding identities already bound to source
receipts. The Worker derives exact object IDs with the bound namespace's
`idFromName`; Web stores the expected identity separately from observed export
identity. Enrollment creates no remote object and grants no Postgres authority.
Creation closure must reject omitted canonical candidates. The database creation
trigger covers concurrent new writers; deletion must retain an owner so a member
cannot disappear between candidate discovery and enrollment. Source binding is
idempotent, rejects conflicting identities, and runs in short database-only
transactions. Initial implementation covers the unsealed cohort; late-source
classification, stable selection and automatic first-use progress remain required
before release. Encrypted legacy cleanup payloads need separate bounded coverage
or proof that their runtime identities are already represented; do not claim the
resource-table census covers payloads it has not read.

- Implemented initial canonical enrollment through the bound Worker and the
  existing import ledger. Source binding is set-based, idempotent and rejects
  both expected-identity and observed-export conflicts. The operator completes
  enrollment before creation closure. Closure now rejects missing candidates.
- A rolling-only database deletion trigger retains missing runtime owners without
  replacing existing authority, closing disappearance between enumeration and
  binding. The trigger adds no retained owner outside rolling mode.
- Validation: 35 real Postgres migration/admission tests and 69 migration-guard
  tests pass; 21 Worker/operator/CLI tests pass. The 101-member pagination case
  includes a new creation between pages and preserves its pending owner. Group
  runtime and resource-only identities are covered; no runner stub is obtained
  during Worker enrollment. Lost binding replies and conflicting pages are covered.
  Web, Worker and shared-contract typechecks and docs drift pass. Complexity passed with both newly added source files included.
- Next: distinguish baseline and late source receipts without changing the sealed
  hash; retain a durable selected source before any local pause so late insertion
  cannot start a second handoff; advance positive empty activation per member;
  finish automatic first use, encrypted historical cleanup coverage, compatible
  release adoption, composed rehearsal and final review/CI. Production is untouched.


## Late-source accounting and durable selection

A real Postgres failing-before test showed that a newly inserted lower object ID
replaces the selected source before its canonical reservation acknowledges. The
campaign now needs one nullable selected-source pointer, committed before any
local barrier, rather than deriving selection from a growing sorted ledger. It has
no clock or expiry and advances only after the source disposition and member
activation. Source reads/transitions/imports reject a different selection.

The existing import ledger gains baseline/late classification. Only baseline
rows contribute to the immutable inventory seal; late discoveries and canonical
bindings remain eligible for exact disposition but cannot admit legacy work by
mere ledger presence. Enrollment/discovery may continue after the seal. Initial
inventory pages still reconcile exactly against baseline rows. The operator
resumes any selected source before unrelated enrollment or provider scans and
checks for late work again before reporting completion. Per-member empty
activation, first-use progress and compatible release adoption remain subsequent
release requirements; no production mutation is authorized by passing this local
increment alone.


## Exact empty-source activation

The previous empty-source path released selection after export but deferred its
member activation until every source was complete. A failing-before Postgres
case reproduced that early advancement from both legacy and pending ownership.
Activation now addresses the selected exact source, requires its complete empty
receipt and sole identity binding, and commits Postgres ownership with the
existing encrypted durable wake. Deleted identities transfer without a wake.
Selection includes expected identities as well as observed identities, so an
empty member holds the selection until activation. Concurrent/lost-reply retries
reuse the wake; prior runtime authority cannot be overwritten. The old fleet
settlement command is a completion audit only and cannot activate an owner.
Worker continuation calls exact activation after export completion.

Late-source and selection verification recovered successfully: 24 real Postgres
tests, 21 Worker/operator/CLI tests, Web typecheck, complexity and docs drift.
The exact empty-activation increment passes 24 Postgres tests, 32 Worker tests,
Web/Worker/shared typechecks, complexity and documentation drift. Failure cases
cover stale versions, wrong selection, incomplete receipts, conflicting bindings
and prior destination authority. Completion audit cannot activate a remaining
owner. The activation reply uses the ordinary member wake shape so the existing
Web callback signals immediately instead of waiting for recovery polling. Automatic first use,
release adoption, encrypted cleanup coverage, composed rehearsal and final public
review remain release blockers. No production changes have occurred.


## Automatic first-use progress

A failing-before Worker orchestration test showed that repeated processing
retries left a newly pending member permanently unactivated without an operator.
The ordinary retry path now enrolls that exact source and advances one existing
handoff continuation. It requires a compatible closed/sealed rolling campaign;
legacy/global-draining/Postgres campaigns are never started or altered by it.
Quiescing sources still route legacy for admitted callbacks, so the legacy RPC
retry path also drives progress. Each external step shares the original request
budget. A timed-out RPC may commit, but its late reply cannot start another step;
the next ordinary retry recovers from source/canonical receipts.

Automatic selection resumes an unfinished selection or chooses only the caller's
pending/late source. It cannot migrate the next baseline member after a bounded
operator canary. Real Postgres proof covers that boundary, explicit operator
continuation and conflicting identity rejection. A second failing-before test
showed repeated enrollment waiting on ordinary shared campaign holders; exact
repeat bindings now receive a read-only acknowledgement without the exclusive
gate. Source effects retain their live authority/selection checks.

Validation passes: 26 real Postgres tests, 56 Worker migration/orchestration
tests and eight focused HTTP ensure-processing cases, Web/Worker/shared
typechecks and changed-source complexity including the new progress module.
Disabled-capability proof confirms no migration calls on legacy deployments. The orchestration test completes four empty export pages and exact
activation through retries, then starts Postgres without an operator. Boundary
proof covers lost enrollment replies, serving mismatch, request expiry and
resuming a different selected member with its own stable token. These remain
local checks; live timing and composed rollout proof are outstanding. Future
compatible release adoption and encrypted historical cleanup coverage are the
next implementation requirements. Production remains unchanged.


## Compatible release continuation

The next failing-before Postgres test reproduced a later compatible deployment
being rejected by the campaign's original Worker-version equality check. Rolling
start now records a deterministic namespace-probe ID generated by the bound
Worker without accessing an object. Signed migration transport derives the
`member-handoff-v1` assertion itself, replacing operator-supplied assertions.
Later releases must match the protocol and original namespace; the initial
Worker version stays recorded and its original requests retain exact-version
compatibility. No release adoption mutates the seal, selection or source/member
receipts. Source RPCs still check the actual serving Worker version before any
freeze, so uncertainty holds only that selected handoff. Legacy admission accepts
compatible overlapping releases without draining unrelated members.

The additive nullable column was applied only to the isolated synthetic database
(now 235 migrations), and Prisma generation succeeded. Validation passes:
27 real Postgres tests, 54 distinct Worker tests across six suites, 69 production
migration-guard tests and Web/Worker/shared typechecks.
Postgres proof includes changing release halfway through a nonempty export and
activating with the same token/wake, immutable campaign state across releases,
positive legacy admission on a later release, and rejection of another namespace
or unsupported protocol. Worker proof reloads a frozen source under a later
release, preserves its exact export/token, and refuses legacy execution. The
transport test proves caller assertions cannot substitute a different namespace.
Final changed-source complexity and documentation drift checks pass.
Historical encrypted cleanup coverage and composed rehearsal remain
release requirements; production is unchanged.


## Historical encrypted cleanup enrollment

A failing-before real Postgres case proved that deleted personal/group runtime
identities represented only in encrypted account-cleanup receipts were absent
from canonical enrollment. The existing enrollment command now prepares one
cleanup payload outside transactions and retains up to 100 identities through
existing FK-free runtime owners. A nullable cursor on the original receipt is
the continuation checkpoint; the owners and cursor commit together, with live
ciphertext/key/environment/cursor revalidation. No new source authority or
scheduler is introduced. The bound Worker still derives exact source IDs.

A rolling-only database deletion guard retains unfinished cleanup receipts even
for old deletion writers. Provider cleanup completion is not source retirement.
Creation closure and final completion check this obligation; duplicate-only
pages keep the operator running. Late receipts preserve the baseline seal.
The nullable cursor and index were applied only to the synthetic database
(236 migrations); Prisma generation passes after shortening the index name to
Postgres's identifier limit. No production changes have occurred.

Focused tests pass: 35 real Postgres cases across cleanup/materialization/member
migration, 23 Worker enrollment/operator/CLI cases, 20 account-deletion owner
cases and 69 migration-guard cases. New proof includes 201-identity pagination,
concurrent preparation, rollback, ciphertext changes, decryption failure,
plaintext zeroing, no database lock during provider work, old-writer deletion,
and late completion accounting. Web and Worker typechecks, changed-source
complexity and documentation drift pass. The operator test uses the required
non-finalizing mode; rolling namespace activation remains forbidden.
Composed rehearsal, measured handoff pause, final public review/CI and rollout
remain outstanding.


## Composed source and canonical migration proof

A new cross-app rehearsal uses the existing public Web testkit seam to connect
actual UserRunner SQLite/KV quiescence, freeze and export to actual Web migration
commands and real Postgres transactions. The protocol scenario passes along with
Web and Worker typechecks. It covers a readiness hold before pause, busy exact
checkpoint request, independent member admission at each phase, a lost committed
import reply, later-release source reload, complete activation with generation
and token retained, unchanged accepted encrypted mailbox work, one activation
wake across retry and duplicate accepted-work suppression. New-member first use
then completes exact empty-source activation while the remaining baseline member
stays legacy and the original seal is preserved.

The test simulates external checkpoint completion and the command transport; it
does not claim real R2 durability, container reply execution, measured production
pause or live latency. Existing transport/version and checkpoint tests cover their
separate boundaries. Direct full-stack reply and provider interoperability proof
remain necessary before production canary expansion. The public testkit resolves
Web-only implementations at runtime, as its existing cross-app helpers do, so
Worker typechecking does not import private Web path aliases.

Private preliminary ReviewGPT returned one accepted coverage finding for its
source-admission/credential boundary. Its original waiter timed out; exact-turn
export recovered the completed response and model evidence. Executable tests now
cover malformed refs, protected-main lookup, commit/ancestry/pin failures and
credential scope. The Linux Bash behavior was checked with an existing local
container image; explicit failed-condition exits also preserve rejection under
macOS Bash 3.2. Private full verification and a new final review are pending.
No production migration has started.


### Cleanup lifecycle corrections verified

Two failing-before cases reproduced later cleanup being retained indefinitely
and a member deleted before first use having no processing retry to advance its
handoff. Ordinary cleanup now reuses its decrypted payload and the existing
receipt/owner transaction to retain at most 100 identities per retry. Its cursor
and existing retry schedule own continuation after the operator stops. The
actual deletion HTTP handler advances one existing per-member continuation under
its original five-second budget, returns retryable, and re-reads routing on the
next request. It never treats member deletion as proof of an empty source.

Validation passes: 30 Web cases (10 real Postgres cleanup cases and 20 existing
account-cleanup owner cases), seven Worker cases including the composed protocol
scenario, and Web/Worker typechecks, changed-source complexity and documentation drift.
The account-cleanup hotspot decreases from 32 to 30. The composed scenario now deletes a pending
member before first use and completes its exact source activation through actual
deletion requests while another baseline member remains legacy; no wake is
created for the deleted member. The cleanup proof covers one and 201 retained
identities, final receipt deletion and preservation of an existing Postgres
owner. External checkpoint completion remains simulated; real container replies,
R2 interoperability, handoff timing, final review/CI and deployment remain gates.
