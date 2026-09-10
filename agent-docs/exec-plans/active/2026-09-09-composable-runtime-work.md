# Decouple hosted work from assistant turns

Status: active
Created: 2026-09-09

## Outcome and protected invariants

Independent hosted work must make bounded progress during an active conversation,
across ordinary reply boundaries, and while unrelated mailbox work is pending.
Foreground model admission and reply delivery retain priority. Canonical files,
receipts, idempotent effects, checkpoint recovery, tenant fences, consent, and
same-conversation causality remain correct under concurrent work.

## Current evidence and owners

Web owns encrypted durable mailbox inputs, device dirty state, and product
permission. Temporal owns pointer-only wake/retry orchestration. Cloudflare owns
one active write fence and restored runtime. Core owns canonical mutations and
write receipts; runtime owns assistant admission, system work, and checkpoints.

The earlier PR overlaps device ingestion with a model request but still aborts
and joins ingestion before reply delivery. Its invocation-local adapter also
holds preparation until a durable checkpoint. The system frontier classifier,
processing modes, ordered selection, and shared checkpoint effects couple
unrelated work. These are hypotheses to reduce, not immutable architecture.

## Investigation and architecture consultation

1. Inspect the complete lifetime from durable admission through selection,
   execution, commit, effect, checkpoint, and recovery for conversation, device,
   detached ask, clinical/environment work, and maintenance.
2. Consult ReviewGPT on the full source snapshot for a simpler long-term target,
   exact deletion candidates, unavoidable ordering, and a concrete refactor.
3. Reproduce the current lifetime/ordering failures with held promises and real
   composed owners. Choose the smallest design supported by that evidence.
4. Build the chosen architecture, delete superseded paths, and update live owner
   contracts. No generic scheduler, second queue, service, persisted mirror, or
   new dependency without a demonstrated requirement.

## Chosen architecture and implementation

ReviewGPT recommends independent attempts within one fenced workspace, one
current publication owner, and existing durable mailbox/domain retry records.
The captured response matches the submitted source head and verified
`gpt-6-pro` response metadata (SHA-256
`dbc918d21e7dc33dfacc54049e2ddd78ab7f0dbc3ea171fa55c57d95648db688`).
Its suggested small patch only removed a metadata-publication reader wait;
the full redesign remains parent-owned implementation work. No attachment was
bound in capture metadata, so local code follows the captured source assessment.

- Separate workspace version/receipt publication from turn input selection.
  All current writers reuse the shared accepted state and serialized metadata
  publication; retain canonical file/rollback locking.
- Admit finite existing device, clinical, and deterministic environment attempts
  from workspace readiness. Claimed mailbox rows exclude duplicate execution;
  recording and retry rows retain their exact domain ownership. No new durable
  queue, service, generic scheduler, or active-task registry.
- Ordinary replies and metadata publication do not cancel independent work.
  Actual snapshot/replacement, shutdown, lost fence, and relevant revocation
  close admission and settle owned work. Initial implementation retains real
  quiescent snapshots rather than adding live snapshot versioning.
- Keep the existing foreground quiet window. Background dirtiness establishes
  checkpoint need without repeatedly extending a conversation deadline.
- Replace global execution-frontier filtering with independent readiness while
  preserving causal preferences, connection epochs, safe handled progress,
  exact acknowledgments, and deployed capability/wire-mode compatibility.
- Keep one shared-writable root model. Voice preparation may overlap; its
  writable assistant step retains the actual root-model authority boundary.

## State, failure, and compatibility

Keep canonical truth with current owners. Reuse durable work identities and
continuations; do not replace them with process-memory queues. Losing a fence,
consent, workspace, or process must stop unauthorized work. Ordinary messages
and replies must not cancel unrelated downloads. Checkpoint construction must
observe consistent state without acknowledging uncommitted work. Independent
work may complete out of order only where per-item evidence preserves retry and
causality. Inspect deployed old/new contracts before changing wire or state.

## Product journey and completion boundary

Effort: product change to execution timing and recovery. A member with a
consented connected source can continue a conversation while imported data
becomes readable. Further replies do not restart the download. An independent
completed environment interview can become useful while that source is slow.

Prove new and established member paths, no-data and delayed-provider behavior,
retry and restart, newer dirty revisions, and authority loss. Preserve model-free
processing when assistant execution is unavailable. The selected journeys are
on hold until composed delivery, canonical readback, and recovery proofs pass.

## Proof and completion

Require a real concurrent chat/import journey that keeps the same download alive
through two replies, independent work-family progress despite a blocked item,
canonical commit/rollback and checkpoint/restart proof, bounded resources, and
consent/fence/shutdown tests. Measure foreground latency, run focused real-Codex
proof when the assistant path changes, affected typechecks, complexity review,
final ReviewGPT, and exact-head CI. Publish a clean reviewable PR.

## Scope and continuation

The user explicitly requested whole-runtime architecture reconsideration with
ReviewGPT followed by implementation, prioritizing deletion and simplicity.
The existing PR #3090 worktree/head was verified as session-owned and clean at
4d8cf15bf88a9407bc2e5cd5d421c8b7793df42e and is now draft for this redesign.
Its earlier R1 reply-stall finding was fixed; R2 and R3 passed. This new product
requirement challenges the remaining turn-scoped cancellation architecture.
The architecture consultation is exploratory, not a fourth final bug-audit
round. Before the renewed final gate, record the cap retrospective and the
user-authorized redesign continuation under the review loop's policy.

No production mutation, merge, deployment, or member message is authorized.

## Baseline proof and architecture findings

- The composed persistent-download case fails before refactoring: events show
  provider fetch, first model completion, provider abort, first reply, then
  second model/reply. Expected: the same provider request stays alive across
  both replies and commits once after release. The failure is the explicit
  no-abort assertion, not a timeout or unrelated setup failure.
- The existing mailbox-state suite explicitly expected a due maintenance item
  to wait behind a future device retry. Its replacement expectation requires
  immediate independent maintenance eligibility. Per-route serialization already
  exists beneath the global frontier projection.
- Snapshot bridge construction already uses the reentrant canonical lock, but
  its scope includes cleanup, archive construction, upload and publication.
  Runtime-only state uses a separate assistant-state lock. Those boundaries
  must be reconciled before allowing arbitrary background state writes across
  snapshots; the lock alone is not proof that all coupled metadata is safe.
- ReviewGPT architecture consultation completed with full source/tests and
  explicit live contracts; one initial unsupported phase flag was corrected
  before any browser submission.
  Conversation: https://chatgpt.com/c/6aa18ea0-075c-83ea-8338-25d437b08daa.
- The independent-maintenance baseline also fails directly: the wake resolver
  returns the device retry one minute later instead of the unrelated due item.
  The underlying selector already separates device connections and route
  actions; the outer global-frontier projections erase that independence.
- The device task currently captures a pass-local canonical write port, receipt
  status, and checkpoint session. Removing its abort alone would leave a task
  using stale pass metadata. Move lifetime and persistence ownership together.
  The hosted invocation already owns shared workspace checkpoint metadata and
  authority; this is a candidate reuse boundary, not evidence for another queue.
- Existing detached assistant reads and image generation have lifetimes beyond
  an ordinary reply. Their capability restrictions remain necessary. The same
  workspace fence does not require independent network work to be serialized.
- Work kinds do not map directly to safe concurrency: clinical import and
  completed environment interviews use deterministic importers, but environment
  voice combines audio download/transcription with a workspace-writing assistant
  notification. Its external preparation can overlap, while the model-writing
  stage must retain the existing assistant authority boundary. Do not launch
  whole handlers concurrently merely because their mailbox kinds differ.
- The persistent-download composed proof now stages a completed environment
  interview behind the device item. It requires two delivered replies and a
  canonical environment update before releasing the same provider request,
  followed by one exact device acknowledgment and a durable log retaining both
  canonical import receipts. Its updated baseline still fails at the explicit
  provider-abort assertion before first delivery.
- Checkpoint publication currently resets one dirty flag and later drains all
  pending completion effects. Concurrent task completion must not join that
  effect batch unless its state was captured. Snapshot metadata derivation,
  state capture, publication, and effect eligibility need one explicit owner;
  retaining only the archive helper's lock is insufficient.
- Baseline verification: the composed suite has three existing scenarios
  passing and the new persistent scenario failing at the intended cancellation
  assertion; the independent-maintenance wake test also fails as intended.
  Assistant-runtime typecheck passes.
- Publication foundation: conversation sessions now share accepted workspace
  and redacted publication state; the pass-local version override and duplicate
  workspace copies were removed. Metadata publication serializes at the
  invocation owner and no longer quiesces detached read-only work. The existing
  runner/startup suites passed 173 tests before the strengthened reader proof.
- The strengthened reader proof fails against the original hosted entrypoint:
  metadata publication aborts the held child before the foreground commit can
  finish. It passes after the change, while shutdown still waits for child exit
  before snapshot construction. This is composed entrypoint proof, not only the
  extracted callback experiment from the architecture consultation.
- Workspace ownership now replaces the turn-owned device controller. The old
  adapter and ingestion-only option were deleted. Existing mailbox claims limit
  one attempt per explicit work family; attempts survive ordinary reply and
  detached-read boundaries. The same owner is being wired through model-free
  startup and an in-place foreground upgrade.
- The persistent-download composed case passes with two replies, a completed
  environment import while the provider stays held, one provider request, exact
  post-snapshot device acknowledgment, and both canonical receipt identities.
  The full pass also produces legitimate automation receipts, so the proof
  checks import identities rather than assuming the log contains only two rows.
- Five existing ownership tests were migrated to the workspace owner and pass:
  concurrent import/readback, full conversation budget, held request and body
  through delivery followed by boundary cancellation, exact recovery without a
  new download, and rollback after rejected authority.
- Receipt, checkpoint race, startup, and mailbox readiness suites passed 96
  tests before the subsequent cold-start changes. Web readiness/store suites
  pass 136 tests. Assistant-runtime and hosted Web typechecks passed at their
  intermediate revisions; final changed-head checks remain outstanding.
- The cold-start extension initially exposed fixture bootstrap initialization,
  then proved an actual stale receipt publication: an old mailbox-status update
  replaced the newer environment receipt after the workspace upgraded to a
  foreground conversation. An explicit internal receipt-append intent now
  prevents ordinary metadata from replacing the shared receipt chain. The cold
  scenario passes through both replies and exact durable import receipt proof.
- General effects now become eligible only when their state was captured by a
  successful snapshot. Later completions stay pending for the next snapshot.
  Snapshot quiescence races foreground interruption while owned attempts remain
  tracked for final release; metadata publication does not cancel readers.
- The broad model-free suite exposed missing browser-replica/projection work,
  timing-log context, progress accounting, and exact device follow-up wake
  propagation. Remediation reuses the existing projection and browser owners.
  Fourteen selected cases subsequently passed; remaining replay/recording and
  final full-owner regression checks are still outstanding. Obsolete test
  assertions that prohibited independent device work during approval/Ask work
  are replaced while retaining exact approval and Ask ordering assertions.
- Web readiness now checks for existing model-free work behind an assistant
  item using the current indexed mailbox store and shared kind/dedupe policy.
  The handled prefix, wire fields, and authority modes remain unchanged. The
  private Temporal reader was inspected read-only: it consumes these existing
  facts and does not own individual network attempts. No private repo mutation
  or new workflow command is introduced; compatibility and deployment evidence
  still need final review.

## Candidate proof and three-round retrospective

The user explicitly chose redesign and implementation after the prior three
final rounds. R1 found a reply-path causal-only barrier; its owning condition
was deleted. R2 passed. A separately reproduced query lock-owner/pending-reader
cycle was corrected by deleting the pending map and using the reentrant lock
plus freshness recheck; R3 passed. The later plan-only commit preserved reviewed
code. This continuation replaces turn-owned import cancellation with independent
workspace-owned attempts, following the requested architecture consultation.
The decision is redesign and continue; the next full sensitive audit is round
four on the same PR, preserving the original first-reviewed head. No new
service, durable queue, schema, dependency, or capability protocol was added.

- Five composed importer/conversation scenarios pass, including cold model-free
  startup and two replies while one provider request remains held. Independent
  environment data commits before that device request is released.
- Accepted metadata cannot restore an old receipt chain or discard a newly
  staged receipt. Both interleavings have failing-before proof and passing
  regressions. A rejected canonical publication rolls back its write.
- Ordinary replies do not join background jobs. Fresh input interrupts snapshot
  quiescence and finishes a foreground turn within the synthetic two-second
  bound while a canceled child remains held; snapshot/release waits for its exit.
- Snapshot metadata is now derived after quiescence, preserving the child's
  retry wake. Generated images retain the earliest exact retention deadline;
  the duplicate workspace-merging helper was deleted.
- Failed vault-share publication retains the exact recording item and does not
  acknowledge dirty data. Browser refresh timeout retry remains owned by its
  existing exact runtime-control item; it is not generalized to device imports.
- The final focused runtime groups pass 273 and 72 tests. The Web readiness and
  store groups pass 137 tests. The earlier nine-file runtime sweep passed 374
  tests before the last focused corrections. Runtime/Web typechecks and the
  complexity ratchet pass; final candidate checks remain required after edits.
- The focused real-Codex wearable-arrival journey passes on gpt-5.6-terra via a
  local subscription. The default and first two alternate homes failed before
  provider action; the third alternate completed both turns. Parent reply
  review: Ready. Missing-data copy is truthful; later canonical CLI readback
  reports the imported distance/duration and correct local/UTC times. No
  production provider-input builder changed.
- Current source review preserves active access, consent, connection epochs,
  exact dirty revision/payload acknowledgments, bounded family admission,
  mailbox handled-prefix authority, root writable-model ordering, and current
  wire modes. Web adds at most one ordered filtered lookup after a default-owned
  live head; no payload read, SQL transaction, or new pooled owner is added.

Remaining: final stable checks/readback, candidate commit and PR rewrite, exact
pushed-head ReviewGPT and CI, mergeability, and plan closure. Production latency,
rollout, and an old binary against a new deployment have not been measured.

## Current-base integration and priority regressions

The current base added validated device-hint coverage, transferred continuation
admission, mailbox diagnostics, and provider handoff observation. The merge keeps
those owners while deleting global execution-frontier filtering. Focused admission
proof distinguishes runnable independent connections from authoritative handled
progress: invalid or unimported continuation ownership cannot advance the prefix.

The preemption suite exposed two missing seams in the broader refactor. Cold
imports now use the existing device deadline cancellation predicate before waiting
for completion. Post-snapshot acknowledgments receive the existing wake-interruption
signal in both model-free and default paths; interrupted effects retain their exact
recording item and can retry. A composed sixth journey reproduces a reply blocked
by an acknowledgment before correction and passes after correction. Ordinary
downloads remain uninterrupted by reply dispatch.

The same suite exposed redundant publication when an already-due wake was derived
again with a later clock timestamp. Equal-reason due wakes now reuse the accepted
opportunity instead of taking another identical snapshot. No persisted state or
retry owner was added. Host abort still cancels background work and preserves the
canonical persistence scope through its final snapshot before surfacing the abort.

Current focused runs distinguish actual safety regressions from old exclusive-mode
fixture assumptions. Due maintenance and device work both execute; failed device
admission retains the existing retry and retention wakes. Recovery fixtures use
the final durable snapshot/version when failed projection changes recording state.
The Web typecheck passed after the base integration. Final runtime checks and the
complexity ratchet are being rerun after the last corrections; a heavily delayed
local module-loading run also produced four pre-existing runner-fixture timeouts,
which require focused rerun before readiness. No timeout threshold was relaxed.

Candidate verification after integration: all 35 priority/preemption and composed
import scenarios pass. Six targeted cases pass after the final acknowledgment
queue simplification, including all four fixtures that timed out during the
delayed run. Web readiness/store tests pass 140 cases. Runtime and Web typechecks
pass. The final complexity ratchet passes: root debt 558 to 558, root maximum
252 to 252, runner debt 59 to 58, and the new system-work owner remains below
20. Fifty-one existing hotspots were reviewed across the changed source.

The completed effect is removed from the existing ready queue only after its
callback returns. An interrupted callback and remaining effects stay available
to the same workspace if it upgrades to foreground processing. No second replay
queue or durable state was added. Parent candidate privacy/conflict checks pass.
The current-base merge is ready to commit; final ReviewGPT, exact-head CI, and
plan closure remain outstanding.


## Round four remediation

The user resumed the accepted finding and explicitly authorized continued fixes,
simplification, and ReviewGPT until merge readiness. This remains preparation of
the open PR; merging and deployment are not authorized. R4 reviewed
`37f86ad0aaf7f938a6a4fa04395563f0aecc6679` on verified gpt-6-pro. One High
REVIEW_INDUCED finding was accepted: the new shared publication owner started
without the restored workspace/status, so its first metadata update could drop a
short canonical receipt log. The existing owner now starts with the sanitized
accepted workspace. An entrypoint regression failed before this correction and
passes through a second crash/restart, with and without an intervening append.
No extra publication owner or persisted state was added.

Broader CI found 17 failures after the earlier focused candidate checks. The
remediation preserves mandatory shutdown effects while independent callbacks
honor interruption; ready durable effects prevent image work from indefinitely
postponing their checkpoint. Explicit due device timers now enter the existing
mailbox claim path, including when a different connection has a future retry.
Completed device alarms are replaced by remaining mailbox work and returned
provider deadlines. Disproved delivery projections explicitly replace the old
wake instead of preserving it through every checkpoint. Generated-image retention
writes explicitly carry the existing due-assistant predecessor through publication.
Old exclusive-work fixtures now assert independent completion while preserving
approval delivery order, failed-item retry state, and contiguous handled progress.
Initialized-timer fixtures restore actual snapshot state so bootstrap authorization
is exercised by the same path as mailbox hints.

The affected 15-file runtime sweep passed 507 of 508 cases; its sole remaining
failure expected a scheduled device wake after the independent job had already
finished. That obsolete expectation was removed; targeted rerun and the added
future-connection timer case remain required. A current-base integration, final
complexity/typecheck proof, fresh full sensitive ReviewGPT, and exact-head CI are
still outstanding. No production latency or rollout has been measured.

Pre-integration verification: the final scheduling/preemption/import group passes
81 cases; the delegated-owner/timer group passes eight. Runtime typecheck passes.
Removing redundant null guards already covered by the due-date helper reduces
root complexity debt from 558 to 557, with maximum 252 unchanged. The runner's
58 debt is unchanged and the independent owner remains below 20. All temporary
diagnostic probes are removed. The accepted R4 correction and CI regressions are
ready for current-base integration and the next full sensitive audit.

Current-base integration preserves the upstream diagnostic deadline helper and
moves the ready-effect image guard into it. The independent Browser Vault suffix
now follows upstream freshness policy instead of forcing a rebuild. The index
conflict combines the two owner summaries; no prior contract is removed. The
integrated eight-file runtime group passes 174 cases, Web readiness/store passes
145, and both runtime and Web typechecks pass. The complexity ratchet against
current main passes: root debt 549 to 547 and max 252 unchanged, runner debt 59
to 58 and max 71 to 70, independent owner max 16. The former final fixture failure
is resolved by the eight-case delegated-owner/timer rerun. Parent review keeps the
existing claims, bootstrap/connection authority, canonical locks, and exact
acknowledgments; no new service, schema, dependency, or second executor was added.


### Round-five CI correction

The exact pushed integrated candidate failed three assertions in the broad
platform-a runtime job (2,976 cases passed). A cold restore kept the original
connection task but also materialized its overdue workspace alarm as another
task. The original completed and advanced canonical cadence; the duplicate
remained due. Admission now reuses an existing due device mailbox item while
continuing to admit a standalone timer beside another connection's future retry.
No new state or executor is added. The unchanged closed-loop test proves one
durable task, bounded provider replay, completion publication, and quiescence.

The other two failures preserved obsolete wake expectations: a completed device
alarm should clear while the canonical running-claim recovery deadline stays in
the default projection, and an already-due assistant mailbox item must precede a
future device retry. Updated assertions retain the restart and eventual-automation
proof and the subsequent assistant-to-device follow-up proof.

Both complete affected files pass all 72 cases. Runtime typecheck and complexity
guard pass; the independent owner remains below the threshold. Temporary
diagnostic probes are removed. The PR returned to draft/Hold while round five
finishes against its original pushed head; the correction needs the next exact
candidate review and CI.

The focused foreground suite also passes 29 preemption and six concurrent-import
cases, including bounded reply dispatch. The corrected candidate is pushed for
CI while the existing round-five capture remains its original review owner; no
duplicate review is launched. Its result and this delta need the next round.


### Round-five ReviewGPT correction

ReviewGPT completed against 8abec78772ae02a67c7dc7eef76aabaa953ece25 with one
accepted High REVIEW_INDUCED finding: cancellation during connection preload,
before service initialization and its durable retry fence, could remove the
unexecuted hint. Capture matched the submitted turn and gpt-6-pro response;
SHA-256 011c4d5a1ae4e32ee6ed89bab1e43034b9f1a07864ecb956fc23c7d729cf8bc4.
The restored-receipt correction was confirmed; no additional serious bug or
material complexity-collapse finding was reported. The user explicitly requests
continued fixing and review to merge readiness, authorizing this bounded
remediation without another resume request from the general review-loop default.

The parent reproduced both workspace-boundary cancellation and the pass's own
timeout at the real entrypoint. Both removed the hint on the reviewed code.
Preparation now retains a yielded no-record result when it requests a retry,
storing that deadline in existing nextAttemptAt. The retention writer preserves
the deadline instead of clearing it again. No-retry unavailable results remain
terminal. Consumed-alarm reconciliation moves from the acknowledgment suffix to
the quiescent snapshot boundary, so pre-service yields without acknowledgment
effects are covered by the same existing rule. No new state owner is added.

Both real-entrypoint cases preserve the exact dirty hint and retry, leave its
handled prefix at zero, restore the accepted snapshot, import the expected
observation, and only then acknowledge the exact payload/revision. The 350-case
surrounding group passed 349; the sole obsolete assertion expected a second
snapshot for the removed false-completion effect. Its expected count is reduced
to one while the test keeps its assistant predecessor and restored retry proof.
The final two-file focused rerun passes all 14 cases, including both new restore
regressions, and runtime typecheck passes. Parent review accepts the reduced
false-completion path and retains the existing authority, acknowledgment, and
foreground-priority boundaries.
The complexity guard passes: root debt equals main at 549 and max 252 is unchanged;
mailbox debt 20 to 19, runner 59 to 58, independent owner max 16.


### Round-six CI correction

Broad platform-a CI exposed nine wake-projection failures in the round-six
candidate. The moved cleanup was too broad: an arbitrary checkpoint could clear
a due device wake even without a mailbox task owning it. Deferred-effect wakes,
late continuations, and publication-only checkpoints must retain that authority.
The parent narrowed replacement to an observed current device mailbox retry or
completed-work recording. Both sites use one small pure wake-selection function;
its extraction removes duplicate deadline conversion and adds no state owner.
The exact existing failure tests are unchanged.

The seven-file correction run passes 167 cases, including all nine CI failures,
the closed-loop import proof, and both pre-service restore regressions. A second
run passes all 260 cases in the remaining ten entrypoint files. Together they
cover every runtime entrypoint test file plus concurrent imports: 427 passing
cases. Runtime typecheck and complexity guard pass; root debt is 548 versus main's
549, maximum 252 unchanged. ReviewGPT round six keeps its original capture owner
and submitted head while this bounded CI correction is pushed; the next exact
candidate review and CI remain required.


### Round-six Complexity Collapse

ReviewGPT verified R5 retry retention and found no remaining Critical or High bug
on its reviewed head. It accepted a bounded Complexity Collapse: the production
caller always provided workspace system-work ownership, disabling the old inline
assistant-phase device executor. Parent repository call-site inspection confirms
one production caller through hosted-runtime.ts. The captured gpt-6-pro response
matches the submitted turn and SHA-256
c111593b2edd81f400704fa2940b40135134b0f86ba93b4676519d528de3f13c.

Delete the unreachable executor and its dedicated scheduling, failure reporting,
activity-automation, staged dirty-ack, and handled-wake helpers. Remove the
turn-owned buffer and suppression/handled flags from root, phase, and runner
interfaces, plus dependent null-only result composition. The workspace owner,
mailbox claims/retries, existing device handler, canonical writes, and accepted
snapshot recording remain the only execution path. No replacement mechanism is
introduced. Common durable effects and mandatory shutdown behavior remain.

Twenty direct-phase tests whose trigger was the unreachable inline executor or its
removed handled-wake flag are deleted. Generic cleanup/outbox/assistant-priority
coverage remains; another continuation test now observes the local schedule
instead of mocking inline execution and explicitly verifies independent routes
are excluded from phase preparation. Two future-retry cases retain their behavior
without the obsolete flag. Real-entrypoint crash, timeout, exact acknowledgment,
reply priority, and closed-loop timer proofs are retained unchanged.

The two adjusted phase files pass 134 cases. Runtime typecheck and the complexity
guard pass: root debt 547 versus main's 549; assistant-phase debt 365 versus 404
and maximum 152 versus 176. The 25-file phase/runner/entrypoint/concurrent-import run passed 23 files;
remaining failures were ten tests invoking the retired executor and two generic
effect assertions expecting its obsolete array wrapper. The generic receipt and
vault-share tests retain all execution, metadata, and context assertions and now
expect the single callable effect. The final three-file rerun passes 157 cases,
including those two and existing device-handler activity scheduling/failure
proof. Every entrypoint, runner, and concurrent-import test passed unchanged in
the broad local run. Runtime typecheck passes again. Existing mailbox and real
entrypoint cases preserve post-snapshot exact acknowledgments and failure retry
diagnostics; no generic shutdown or delivery behavior is removed. The cleanup
deletes over 800 net production lines and adds no state, dependency, or service.
Parent diff and privacy review pass; proceed to the next full sensitive review.
