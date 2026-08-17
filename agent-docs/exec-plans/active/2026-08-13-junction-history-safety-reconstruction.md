# Reconstruct Junction history safety on current main

Status: active
Created: 2026-08-13
Updated: 2026-08-17

## Goal

- Preserve current main's Junction catalog, pagination, dense/workout policies,
  compact 13-slot matrix, and recent follow-up behavior while restoring the
  exact-source lifecycle and sparse-history safety invariants that were unique
  to superseded PR #1696.

## Success criteria

- Every reconnect admission owner advances the exact Junction source lifecycle
  once and clears only that source's schedule-time coverage. Read fences stop
  known-stale jobs before provider discovery, fetch, preparation, or import;
  a lifecycle change observed after import stops continuation and certification.
- Extended sparse history offers at most one uncovered coordinate per scheduler
  pass, preserves current main's bounded continuation behavior, and emits no
  history root once every admitted coordinate has completion coverage.
- Current main's 13-slot `m1` mapping/defaults, pagination, dense/workout
  exclusions, and post-#1698/#1736 ownership remain unchanged unless focused
  proof shows a direct incompatibility.
- Focused SQLite/hosted/runtime proofs, package suites, typechecks, runner bundle
  limits, preliminary specialist ReviewGPT, final ReviewGPT, and required PR CI
  are green on the exact replacement-PR head.

## Scope

- In scope:
  - Source lifecycle epoch persistence, hydration/projection/admission fences,
    schedule-time job binding, and pre-import/post-import rereads.
  - Deterministic cap-one scheduling of uncovered sparse-history coordinates.
  - Existing SQLite/Postgres schema, hosted hint, runner, and direct proof
    surfaces required by those invariants.
- Out of scope:
  - Replacing or remapping current main's compact matrix.
  - New provider resources, query/tool surfaces, dense samples, workouts, ECG,
    prompts, frontend, or member-visible copy.
  - Wholesale commits, trees, docs, tests, migrations, or abstractions from the
    unrelated-history #1696 branch.
  - Rolling verification or late-fact recovery after a coordinate's existing
    completion bit is set; the composed provider load is not acceptable without
    a separate bounded ownership design.

## Constraints

- Technical constraints:
  - The reconstruction started from exact origin/main snapshot `96d23af` and
    then integrated current main through `fc954786c9` before candidate proof;
    port behavior manually into current owners and treat the old branch only as
    a reference.
  - Reuse the existing source row, job queue, metadata slots, scheduler cadence,
    and immediate SQLite enqueue transaction. Add no table, cursor owner,
    manager, queue, lifecycle service, or permanent verification process.
  - Keep provider/network work outside database transactions and quantify
    maximum admitted-cardinality fanout.
- Product/process constraints:
  - Preserve current sync, onboarding, reconnect, canonical import, billing,
    consent, and hosted/local rollout invariants.
  - Keep the old #1696 PR open until the replacement PR exists.
  - Use the PR worktree lane, exact-head ReviewGPT specialist/final gates, scoped
    commits, and plan closure through `scripts/finish-task`.

## Risks and mitigations

1. Risk: copying obsolete #1696 shapes could regress newer pagination or the
   13-slot matrix.
   Mitigation: diff owners and focused tests concept-by-concept; never cherry-pick
   the old commits or transplant whole files.
2. Risk: scheduling every coordinate forever would compose to unacceptable
   provider load at maximum cardinality.
   Mitigation: preserve the compact completion-bit gate and offer only one
   uncovered coordinate per scheduler pass; all-covered accounts emit none.
3. Risk: lifecycle repair can create another state owner or clear sibling/source-
   first coverage.
   Mitigation: keep epoch and coverage mutation on the exact existing source-row
   admission transactions and fence provider/fetch/import decisions with live reads.
4. Risk: late sparse facts remain outside this foundation after initial
   completion.
   Mitigation: state that limit explicitly and defer recovery until a separately
   reviewed design proves a bounded trigger and ownership model.

## Tasks

1. [completed] Inventory current main's Junction resource policy, matrix, pagination,
   lifecycle schema, scheduling, continuation, hydration, hosted hint, and tests;
   compare only the unique safety mechanisms in old head `e6b6340`.
2. [completed] Implement lifecycle epoch persistence and every hosted/local/source/job fence;
   add migration, atomicity, replay, hydration, and stale-work proof.
3. [completed] Add deterministic cap-one scheduling for uncovered coordinates while
   preserving current pagination, completion-bit suppression, and retry owners.
4. [completed] Audit rolling verification and reject it from this foundation because
   its composed maximum-cardinality provider load is unacceptable.
5. [completed] Run focused and comprehensive verification, bundle/type boundaries,
   privacy scans, scope/shape review, and update durable docs only where current
   owner contracts materially change.
6. [completed] Commit and push a candidate, open a replacement PR with exact intent/load/
   deployment/shape/proof metadata, then run preliminary specialist and final
   ReviewGPT concurrently with CI.
7. [completed] Complete and record the required round-2 anomaly retrospective:
   reject tactical alias guards and a raised 420-key bound, and choose one
   catalog-derived semantic lifecycle identity with no new persisted owner.
8. [completed] Collapse Apple Health alias/canonical lifecycle ownership at the
   existing source boundaries; prove legacy coexistence, reconnect, hydration,
   scheduling, execution fencing, certification, and hosted apply end to end.
9. [in_progress] Re-run focused/comprehensive proof, push the remediated head, obtain
   a later ReviewGPT PASS plus exact-head green CI, perform parent final review,
   close this plan with `scripts/finish-task`, and land.

## Decisions

- Use current main as sole architecture authority; old #1696 is behavioral
  evidence only.
- Port lifecycle safety before history terminality so every later job proof is
  bound to the real source epoch.
- Preserve the current `m1` 13-slot layout and current pagination by default.
- Completion coverage is monotonic initial-obligation evidence, not a claim of
  permanent provider completeness.
- Every resource classified by the package-owned Junction timeseries policy as
  extended uses a fixed 180-day initial window. The policy's resource set is
  unchanged; `timeseriesBackfillDays` remains the public generic bound for
  dense/default resources, ECG voltage, workout streams, and full-timeseries
  collection; `summaryBackfillDays` continues to own summary history and does not
  set the extended horizon.
- The final pre-import lifecycle read prevents known-stale imports but is not an
  atomic importer-write fence. A reconnect racing after that read can overlap an
  import; the post-import read still prevents stale continuation or certification.
- Use an intentional intermediate `scripts/committer` checkpoint before merging
  the newer current-main device-sync changes; keep this plan active until the
  integrated candidate completes its PR review gates.
- Changelog is not applicable: this is internal lifecycle/scheduling hardening,
  not a new member-visible capability, interaction, or safely distinct public
  outcome.
- Maximum schedule-time candidate cardinality remains 396 source/resource
  reconnect obligations: 33 source slots multiplied by 12 schedule-time
  resource/version coordinates. Blood pressure remains the thirteenth matrix
  slot, but its independent source-first roots are not cleared by reconnect.
  Each due pass performs one bounded SQLite membership query over at most 396
  dedupe keys, prioritizes an inactive reopened-lifecycle coordinate, and
  offers at most one current-day root for the account; fully covered or already
  active candidate sets offer none. Dead keys become eligible again. Rolling
  verification remains out of scope because it would reintroduce unbounded
  composed provider work.
- A maximum-cardinality current-day execution performs six source-authority
  reads in the tested order `[target, all, target, all, target, target]`: four
  exact-source lifecycle fences, one shared projection snapshot, and one shared
  import-preparation snapshot. Neither shared read scales with provider count.
- The specialist request for a member-visible “restoring history” state is
  rejected as scope expansion. Settings freshness is the current sync/action
  projection, history completion is intentionally redacted, reconnect and
  backfill are separate automatic stages, and there is no member recovery
  action to present. Exposing coverage would require a new product projection.
- Cross-package Web-to-runner-to-apply behavior remains proven at package-owned
  seams instead of a coupled mega-test: Web persists lifecycle epoch two in its
  bounded snapshot, assistant hydration clears only superseded local
  schedule-time bits before merge, the scheduler emits an epoch-two root, and
  reconciliation proves the cleared bit is not emitted back to Web.
- Deploy the additive Prisma migration first, then the Cloudflare runner and
  confirm new runner builds are active before deploying Web. The Web write
  guard rejects missing lifecycle observations for epochs above one and protects
  against old-runner stragglers; Web-first is unsafe because it can clear
  schedule-time coverage before the cap-one runner behavior is active.
- Round 2's full-snapshot audit is accepted as a requirement-level
  `RETROSPECTIVE_REQUIRED` signal. Independent static and executable proof
  confirmed that the current scheduler constructs 420 active-dedupe keys when
  canonical Apple Health plus both admitted aliases coexist, exceeds the 396
  guard, and can resurrect unpublished alias coverage after a canonical
  reconnect. The same split leaves old alias-bound work admissible.
- Retrospective decision: the Connect route catalog is the sole lifecycle
  identity owner. Its canonical route slug defines source-instance identity,
  reconnect admission, hydration, scheduling/dedupe, lifecycle fences,
  continuation/certification, and hosted projection. Raw slugs may remain only
  as provider transport facts where needed. Existing alias rows collapse at
  the ordinary Web/SQLite source-owner transaction, not through a migration
  manager, repair loop, new table, second lifecycle, or raised raw-alias bound.
- Rejected an assistant-only alias match because it repeats the same mechanism
  while leaving admission, scheduling, execution, and hosted apply split.
  Rejected raising the lookup guard to 420 because one visible source must own
  one lifecycle and one set of obligations. Rejected a persisted canonical-ID
  column because the code-owned catalog already provides the identity.
- The ordinary Web and SQLite source owners now collapse catalog-equivalent
  rows on their bounded read/write paths. The collapse keeps the maximum epoch,
  applies fail-closed same-epoch status and disconnect-fence authority, preserves
  earliest/most-recent observation timestamps, unions bounded availability
  deterministically, writes the canonical row before deleting legacy aliases,
  and adds no migration, repair loop, or second identity owner.
- All extended-history roots, including blood pressure, now carry the exact
  lifecycle epoch. Blood pressure remains source-first and independently bounded
  at 33 roots; the schedule-time active-key lookup remains exactly 33 by 12, or
  396. Filtered local reads expand only the catalog-equivalent slugs so legacy
  alias-only rows participate in pre-provider admission and arrival stamping.
- Preserve lifecycle-epoch wire presence independently from its effective local
  value. Old-Web snapshots omit the field and still hydrate locally as epoch 1,
  but canonicalization must not manufacture a field that a strict pre-epoch Web
  apply parser rejects. If any canonical candidate supplied an epoch, retain the
  maximum observed value so current Web stale-apply fencing remains intact.
- Reopened schedule-time history keeps stateless priority without absolute
  ownership of the account-wide lane. When reopened and ordinary inactive
  coordinates coexist, three hourly slots select reopened work and the fourth
  selects ordinary work; a single nonempty pool retains every slot. This bounds
  unrelated ordinary progress to four passes while preserving the one-root
  limit, active-key suppression, the 396-key query, and independent source-first
  blood-pressure roots without adding retry history or another state owner.
- Round-5 scheduler-fairness retrospective: the original requirement is one
  cap-one, stateless scheduler that prioritizes reopened history while eventually
  admitting every eligible coordinate. The first-reviewed shape rotated one
  stable sorted pool with the absolute hourly slot. Review remediation added
  active-key suppression, reopened priority, and then a two-pool 3:1 cadence;
  reusing the same absolute slot both to choose the ordinary residue and to
  index that pool repeated the starvation mechanism for pool sizes sharing a
  factor with four. Deleting reopened priority would restore avoidable reconnect
  repair latency, treating dead work as coverage would be false, and a persisted
  cursor or repair loop would add a second owner. Continue with the smallest
  stateless shape: derive a cycle number and within-cycle offset from the existing
  hourly slot, use consecutive logical ordinals for the three reopened offers
  and one ordinary ordinal per cycle, and retain ordinary absolute-slot rotation
  when no reopened pool exists. Prove the production selector across mixed pool
  sizes through the 396-coordinate bound, shared factors with four, stable dead
  coordinates, active-key suppression, successful-coordinate removal, and
  ordinary on-time scheduler passes.
- An established local Junction source-start is the earliest reconnect owner
  that can fence already-running work. Atomically advance the existing account's
  `local_connection_revision` when that owner changes a connected source to
  disconnected; the worker's existing success transaction then rejects the old
  result. Do not clear source-first blood-pressure coverage, add a second
  lifecycle, reread the provider, or add queue/process state. New sources and
  repeated starts against an already-disconnected source do not advance the
  revision; callback admission remains the sole lifecycle-epoch increment.
- A hosted Junction source-start is likewise the earliest durable boundary that
  can reject an older metadata-only runner apply. Advance the existing parent
  connection `updatedAt` in the same advisory transaction as the source claim,
  choosing a timestamp strictly after both the source and parent versions. This
  reuses the apply protocol's existing `observedUpdatedAt` CAS and adds no field,
  schema, lifecycle owner, provider read, or queue.
- Hosted hydration must also prevent a rejected stale apply from surviving in
  runner-local SQLite and being republished on a later current-epoch apply.
  Before merging durable hosted metadata, clear all thirteen target-source
  completion coordinates when the hosted source is disconnected, carries the
  existing disconnect fence, or has a newer lifecycle epoch. The ordinary merge
  then overlays any durable hosted completion truth, while sibling-source
  coverage remains untouched.
- Round 7 is the configured final-review hard cap. Its accepted hosted-runtime
  finding is remediated and verified below, but no round 8 is started without an
  explicit continuation decision. The review gate therefore remains open even
  after this remediation is pushed.
- The user explicitly authorized continuation beyond the round-7 hard cap.
  Continue the indivisible Web/runner reconnect invariant in this PR because
  the producer version fence and consumer hydration cleanup reuse existing
  owners; splitting them would separate the two halves of one stale-work guard.
- Generic source upsert owns one canonical point write, not collection-wide
  legacy reconciliation. Transactional `listConnectionSources` remains the sole
  owner of the full physical alias collapse and passes its one loaded snapshot
  into reconciliation. Bounded webhook admission may collapse its exact alias
  group semantically and write the explicit next canonical epoch; a later owning
  list removes the legacy physical row without changing epoch authority. This
  deletes the repeated collection scan from every canonical transactional
  upsert and adds no parameter, flag, cache, or second reconciliation owner.

## ReviewGPT evidence and finding ledger

- The valid preliminary `completion-specialists` retry reviewed exact head
  `e46164ab9afafd14755b10c5612a89686081a30a` with `gpt-5-6-pro` for about
  38 minutes 26 seconds (04:06:32 attachment through 04:44:58 capture) in
  [its review thread](https://chatgpt.com/c/6a7e9449-f58c-83ea-8763-a060e29a011b).
  It returned `SPECIALIST_OUTCOME: FINDINGS` and was valid.
- Valid final ReviewGPT round 1 reviewed exact head
  `37ab85e625df815e3b62c246bb8e3fcf76d21233` with `gpt-5-6-pro` for 65
  minutes 17 seconds in
  [its review thread](https://chatgpt.com/c/6a7e7812-469c-83ea-b23b-70481500c1f3).
  It returned `ROUND_OUTCOME: FINDINGS` and `REVIEW_COMPLETE`.
- Accepted and fixed: project `lifecycleEpoch` from the bounded Web raw SQL and
  prove it against real Postgres; clear exact per-provider local coverage before
  assistant hydration merges a newer hosted epoch; preserve the pending Link
  source timestamp while a queued local job projects disconnected state; make
  the stale source-start callback a terminal fresh-start response; keep
  blood-pressure roots independent of the cap-one schedule-time lane; use active
  queue ownership to prioritize reopened inactive work; prove the 396-coordinate
  ceiling and maximum scheduler behavior; share the `projectJunctionSources`
  source snapshot so projection is O(N) with the exact six authority reads;
  prove exact 33-by-13 coverage clearing; and instrument the maximum locked path.
- Rejected the specialist suggestion to expose a member-visible “restoring
  history” state. The cited headline/detail/guidance is not rendered by the
  current cards; fresh sync is not history completeness; the unchanged UI only
  promises connected/learning; catch-up is automatic; and completion metadata
  is intentionally redacted. A truthful state would require a separate product
  projection, UI/catalog work, and changelog rather than leaking this internal
  safety mechanism into the current patch.
- Rejected one cross-owner Web-to-runner mega-test because it would couple
  package internals without proving more authority. The remediation instead
  strengthens the Web, assistant-runtime, device-sync, SQLite, and Postgres
  owner seams individually.
- Accepted the round-2 Apple Health identity finding and the independent
  remediation audits: Web now collapses before semantic status filtering and
  uses deterministic availability order; assistant hydration preserves a
  same-epoch disconnect fence and bounded availability across all aliases;
  local filtered reads and arrival stamping include semantic aliases; and
  blood-pressure work is lifecycle-bound before provider access. Redundant
  importer, diagnostic, and second-owner rewrites were removed from scope.
- Valid final ReviewGPT round 3 reviewed the immutable remediated snapshot
  `934caa27674251fd12bf416d96a6b8bbc21401c3` with `gpt-5-6-pro` and returned
  `ROUND_OUTCOME: FINDINGS` plus `REVIEW_COMPLETE`. Accepted: Junction
  canonicalization had converted an omitted old-Web epoch into a present epoch
  1, so an ordinary source delta would send `observedLifecycleEpoch` to the
  strict pre-epoch apply parser and reject the complete callback before any
  mutation. The correction keeps effective epoch 1 for local authority while
  serializing an epoch only when at least one hosted candidate supplied it.
  Production-path proof covers old-Web Apple aliases through JSON wire shape and
  a frozen pre-epoch allowlist, plus the complementary epoch-bearing reply.
- Valid final ReviewGPT round 4 reviewed exact head
  `7b1b380cf60ca5c4c3203d63e70744369880b4d8` with `gpt-5-6-pro` for 84
  minutes 13 seconds and returned `ROUND_OUTCOME: FINDINGS` plus
  `REVIEW_COMPLETE`. The waited wrapper lost its final CDP capture after the
  response completed; a read-only export of the existing accepted thread
  recovered the single marked result without resending the prompt.
- Accepted: absolute reopened-only schedule-time selection can repeatedly
  re-enqueue one dead nonretryable coordinate and starve an ordinary epoch-one
  coordinate indefinitely. The correction derives reopened and ordinary pools
  from the existing inactive set and reserves every fourth deterministic
  schedule slot for ordinary work when both exist. It adds no persisted state,
  queue, retry policy, manager, or second owner.
- Valid final ReviewGPT round 5 transport retry reviewed exact head
  `83dd248bdcb3b6ec53635d59f46a12503b56f955` with `gpt-5-6-pro`, returned
  `ROUND_OUTCOME: RETROSPECTIVE_REQUIRED` plus `REVIEW_COMPLETE`, and identified
  a repeated fairness mechanism: ordinary admission is limited to absolute
  slots congruent to three modulo four, then the same absolute slot indexes the
  stable ordinary pool. Pool sizes sharing factors with four therefore contain
  permanently unreachable coordinates. The preceding accepted round-4 fix is
  not closed. The required requirement-level decision is recorded above before
  implementation. An earlier accepted round-5 transport attempt completed
  reasoning but stored no final assistant response; it is an invalid empty
  capture and carries no verdict.
- The first final round-6 attempt on exact head
  `11d9c13d44465929ea62c7f9e010cac3811c94dc` was invalid: although it included
  the exact patch and rounds 2-5, it omitted the round-1 finding ledger required
  by the final-gate continuation contract. It returned `ROUND_OUTCOME: INVALID`
  and carried no code verdict.
- The corrected final round-6 retry reviewed the same exact head with the full
  rounds 1-5 ledger in
  [its review thread](https://chatgpt.com/c/6a7f9de7-2310-83ea-a7ff-17aed754e7c6).
  It returned `ROUND_OUTCOME: FINDINGS` plus `REVIEW_COMPLETE` and identified
  one accepted race: an old-lifecycle blood-pressure worker can finish import
  after local reconnect starts but before callback admission, then certify
  source-first coverage because source-start had not advanced the account
  revision and the final provider guard applies only to current-day resources.
  The accepted correction advances the existing revision inside the ordinary
  source-disconnect write transaction and relies on the existing atomic worker
  success fence. Production complexity is one optional owner flag and one
  bounded update in the existing transaction; the larger change is regression
  proof for the real SQLite interleaving, callback epoch, replacement schedule,
  and preservation of already-complete blood-pressure coverage.
- Valid final ReviewGPT round 7 reviewed exact head
  `0857bcf9445fa26b34e4f3cbbef3ee359e00bbc2` with `gpt-5-6-pro` in the same
  corrected review thread for about 54 minutes. It returned
  `ROUND_OUTCOME: FINDINGS` plus `REVIEW_COMPLETE`. A preceding preflight failed
  before send because its full-snapshot anchor named the prior head; it had no
  code verdict and did not consume a review send.
- Accepted: the local SQLite revision fence from round 6 did not cover the
  hosted browser/companion source-start owners. Those owners changed a child
  source without advancing the parent connection version, so a metadata-only
  old blood-pressure completion could still satisfy the Web apply CAS. Even a
  rejected source-bearing apply could leave the stale completion in runner
  SQLite, where later hydration retained and republished it. The correction
  advances the parent version atomically at hosted source-start and clears all
  target-source coverage on fenced/newer hosted hydration before durable hosted
  metadata is overlaid. The fix adds one exact parent timestamp write and one
  shared bounded cleanup helper; it adds no new state or asynchronous machinery.
- Local and tunneled `device-syncd` reconnects remain part of the original
  cross-runtime lifecycle outcome; narrowing or splitting them would leave the
  same semantic source with divergent callback authority. Use one shared
  stateless callback-admission decision in the existing package owner. A
  disconnect fence or an older callback while a newer source start remains
  pending rejects without mutation. Once an independently consumable Link state
  completes successfully, every existing-source completion advances the current
  lifecycle, exact schedule-time coverage owner, account revision, and existing
  initial-job transaction. Same-state replay is rejected before this owner.
  Junction supplies no registration generation that could make target cleanup
  safe after a later completion, so do not add a rollback hook, generation
  field, queue, manager, second lifecycle, or reconciliation process.
- Valid final ReviewGPT round 8 reviewed exact head
  `2f6d78c233a8e9a78c32cbc9283affda58e281ad` in the existing review thread
  after the explicit hard-cap continuation decision. It returned
  `ROUND_OUTCOME: FINDINGS` plus `REVIEW_COMPLETE` after about 50 minutes. The
  response reported `MODEL_CONFIRMATION: UNKNOWN`, but the package-owned
  sidecar bound the exact response hash to the requested compatible
  `gpt-5-6-pro` slug, so the long-turn UNKNOWN fallback is valid. One preceding
  metadata preflight failed before send because a full snapshot required the
  current head as its context anchor; Eragon then failed before send because
  its attachment control was not ready. The valid retry sent once on Phlebas.
- Accepted: generic transactional canonical upsert repeated the full physical
  alias-reconciliation read even after the same transaction's owning source
  list had loaded and reconciled the complete collection. A maximum real
  Junction apply therefore performed 33 redundant full source-set scans while
  holding the connection mutation lock and pooled transaction. The correction
  deletes that seven-line branch and leaves canonical point normalization in
  place. Existing transactional callers already perform the owning full or
  exact-group read before writing. No finding was rejected in this round.
  Production complexity decreases by one owner path and seven lines; focused
  proof replaces the mocked statement-count assumption with the real store and
  migrated Postgres operation counters.
- Valid final ReviewGPT round 9 reviewed exact head
  `f205e8a52bd42ca1d73abe8241a30704f5db6efd` in the existing thread and
  returned `ROUND_OUTCOME: FINDINGS` plus `REVIEW_COMPLETE`. The response
  reported `MODEL_CONFIRMATION: UNKNOWN`, while the package-owned sidecar bound
  the exact response hash to the requested compatible `gpt-5-6-pro` slug; the
  long-turn UNKNOWN fallback is valid. Mountain failed before send because its
  attachment control was not ready; the valid Phlebas retry sent once.
- Accepted the overlapping-Link lifecycle finding. Independently consumable
  OAuth states can complete out of start order, and once one callback has
  connected the exact source the disconnected-only branch previously let a
  second completed provider registration reuse its epoch and retained coverage.
  Every successful existing-source Link completion now reuses the same callback
  transaction to advance the epoch and reopen exact schedule-time coverage.
  The older callback still fails with no mutation while the newer source start
  remains pending. No provider-generation state, queue, read, or cleanup owner
  was added.
- Accepted the complexity-collapse finding. The deferred webhook admission path
  had removed the last production caller of a complete 134-line exported source-
  registration reconciliation workflow, leaving only a direct test invocation.
  Delete that export, its dedicated error helper, import, and unreachable test
  fragment. Production behavior needs no replacement: deferred native webhook
  admission and browser Link callback admission remain the two live owners.
  No round-9 finding was rejected; the remediation deletes 136 net production
  lines while adding focused callback-lifecycle proof and narrowing the durable
  callback contract.
- Valid final ReviewGPT round 10 reviewed exact head
  `c3efefabaede240673b84359aab5e2c400e09e18` in the existing thread and
  returned `ROUND_OUTCOME: RETROSPECTIVE_REQUIRED` plus `REVIEW_COMPLETE`.
  The package-owned sidecar binds the exact response hash to the requested
  compatible `gpt-5-6-pro` slug. One packaging attempt lost the shared transient
  PR-context directory, one metadata preflight required the current full-
  snapshot anchor, and Hercules failed before send because its attachment input
  was not ready. The valid Phlebas retry sent once.
- Accepted the repeated-mechanism retrospective trigger: the local SQLite
  callback owner still rejected every independently successful callback once
  the source was connected, so an out-of-order completion could change the
  provider registration without advancing local source authority, clearing
  target coverage, or invalidating earlier jobs. The round-9 hosted correction
  therefore exposed an unchanged cross-runtime policy split. The original
  requirement already includes local and hosted lifecycle admission; keep both
  and align them through one shared stateless truth table rather than another
  tactical branch. Owner-local Web and real-SQLite/service proofs remain the
  test boundary; the previously rejected cross-owner mega-test is still
  unnecessary.
- Valid final ReviewGPT round 11 reviewed exact head
  `b2c71effbe36ac36f5797566ac4f6dbb968de785` in the existing thread and
  returned `ROUND_OUTCOME: FINDINGS` plus `REVIEW_COMPLETE` after a substantive
  full-snapshot audit. The response hash matches the package-owned
  `gpt-5-6-pro` sidecar. One earlier attempt failed before send when the known
  shared transient PR-context directory lost `pr-body.md`; the pinned Phlebas
  retry sent once and completed after about 77 minutes.
- Accepted the remaining alias-identity seam. The bounded webhook admission
  reader correctly projects an alias-only Apple Health row onto canonical
  semantic authority without rewriting it, but its cross-provider-I/O proof
  also captured the physical Prisma row ID. An ordinary owning source read can
  replace that alias row with a canonical row while preserving every semantic
  lifecycle field; the later ID comparison then terminally consumes the valid
  registration without lifecycle or work effects. A migrated-Postgres race
  reproduced the exact epoch-1 disconnected result after physical rekey.
- The round-11 retrospective keeps the original round-2 decision: canonical
  source identity, lifecycle epoch, status/fence, error state, timestamp, and
  parent credential epoch are authority; a physical storage ID is not. Delete
  `id` only from this bounded cross-provider-I/O candidate, mapper, and
  comparator. Retain unrelated row-ID proofs whose transactional owner first
  physically canonicalizes its rows. This shrinks the proof instead of adding
  a schema field, alias compatibility owner, retry, queue, manager, repair, or
  reconciliation path. One real-Postgres owner-race test is the complete proof
  boundary; no cross-owner mega-test is needed.
- Valid final ReviewGPT round 12 reviewed exact behavior head
  `1c01b72f56047aa692032d0a6bfce3c832750ccf` in the existing thread and
  returned `ROUND_OUTCOME: PASS` plus `REVIEW_COMPLETE` after about 68 minutes.
  The response hash matches the package-owned `gpt-5-6-pro` sidecar. Mountain
  failed before send because its composer attachment input did not match the
  target; the pinned Phlebas retry sent once. The fresh full audit verified the
  round-11 physical-rekey deletion and all prior correction mechanisms and
  reported no remaining qualifying finding. The final ReviewGPT gate is
  complete with zero unresolved accepted findings.
- Final ReviewGPT round 13 reviewed exact current-main integration head
  `f34b9ac3a237a07c9cb91449b801af60f3f124a0` in the existing thread and
  returned `ROUND_OUTCOME: FINDINGS` plus `REVIEW_COMPLETE` after about 58
  minutes. The prompt was accepted once, but ReviewGPT could not persist its
  initial capture metadata; the same-thread wake path recovered the completed
  response without resending the round.
- Accepted the integration identity seam. Current main intentionally preserves
  an established opaque Junction source key, but local reconnect start, hosted
  source start/callback, and hosted runtime apply still used the catalog-derived
  key as an existence key. Reconnect could therefore create a second physical
  row without advancing the old worker revision or hosted parent boundary, and
  a stale source-first blood-pressure completion could survive the callback as
  current coverage. Focused SQLite, hosted-start, and runtime-apply regressions
  reproduced all three missed-owner effects before remediation.
- The accepted correction at `0186631c3d33` resolves route-equivalent source
  authority before choosing the physical point-write identity. Existing opaque
  identity is preserved; the deterministic key is used only for a genuinely
  new source. One shared pure hosted resolver composes the existing identity
  and lifecycle rules for source start, callback, and runtime apply. No finding
  was rejected. The fix adds no persisted field, provider generation, queue,
  retry owner, manager, repair loop, reconciliation process, or provider call;
  its only structural cost is the small stateless resolver shared by the three
  existing Web owners.
- Final ReviewGPT round 14 reviewed exact remediated head
  `3d3f53514ac1187a6f60987059d780b15f9bdd8e` in the existing thread and
  returned `ROUND_OUTCOME: RETROSPECTIVE_REQUIRED` plus `REVIEW_COMPLETE`.
  It found that native companion reconnect still rebuilt the deterministic
  source key after admission had resolved an established opaque Apple Health
  identity. A later disconnect could therefore write an older opaque row while
  a webhook had advanced the deterministic row, letting provider revoke succeed
  without making the durable semantic source disconnected.
- Accepted the round-14 finding and repeated-owner retrospective. Round 13
  inventoried route-equivalent reads and the browser/runtime point writers but
  did not explicitly follow the native companion reconnect through webhook and
  disconnect as one cross-row lifecycle. The durable stance is now explicit:
  a bounded legacy duplicate set is supported, but it represents one semantic
  source; admission resolves one established physical identity at the maximum
  lifecycle epoch, and every existing-source point write carries that epoch
  onto that identity. Deterministic identity is used only when no semantic
  source exists. The owners covered are native capture/start, browser start and
  callback, registration webhook, disconnect/cleanup, companion admission, and
  hosted runtime apply.
- No round-14 finding was rejected. The correction adds one bounded admission
  sentinel and reuses the existing pure semantic resolver and point-write
  owners. It adds no persisted field, duplicate repair, deletion pass, queue,
  retry policy, lifecycle manager, or provider call. The production delta is
  deliberately smaller than the regression proof required to cover the full
  native-connect, webhook, disconnect, reconnect sequence in real Postgres.
- The user explicitly requested the latest ReviewGPT before the next round.
  The repo first advanced to `@cobuild/review-gpt` `^0.5.131` with the matching
  exact minimum-release-age exception and minimal lockfile resolution update.
  After round 15 completed, `0.5.132` became the registry latest, so the same
  narrow consumer files advance again before round 16. No transitive resolution
  changes are admitted beyond the ReviewGPT package entry.
- Final ReviewGPT round 15 reviewed exact head
  `0eb0e97ade06b6bf863d8c93cef85e727e65f9f5` in the existing thread and
  returned `ROUND_OUTCOME: FINDINGS` plus `REVIEW_COMPLETE`. The initial waited
  capture failed closed after send because ChatGPT did not retain provable ZIP
  attachment metadata; the committed-turn recovery watched the active review
  to completion, and a read-only final-assistant export recovered the one marked
  substantive result without resending the round.
- Accepted the round-15 explicit companion-connect finding. The native start
  owner still returned early for a connected, unfenced semantic source, so an
  explicit `connectionIntent: connect` could mint a usable SDK token without
  writing the pending source boundary or advancing the parent connection
  version. Its later signed provider-registration webhook then classified the
  unchanged source as already admitted and retained old schedule-time coverage.
- No round-15 finding was rejected. Delete that early return so every explicit
  companion connect reuses the existing source-start transaction, while the
  separate passive `resume` path remains non-mutating. Established identity,
  current lifecycle epoch, retained source-start coverage, parent-version fence,
  webhook epoch advance, exact 12-coordinate clearing, and replacement
  scheduling all remain owned by their existing paths. The correction removes
  a branch and adds no state, status, provider read, field, queue, retry owner,
  manager, cleanup process, or reconciliation loop.

## Verification

- Commands to run:
  - Focused lifecycle, provider, history, store, hosted-runtime, hosted-Web, and
    assistant-runtime tests selected after the owner inventory.
  - `pnpm --filter @murphai/device-syncd typecheck`
  - `pnpm --filter @murphai/assistant-runtime typecheck`
  - Complete `@murphai/device-syncd` tests once focused proof is stable.
  - Supported Cloudflare runner assembly and parity/bundle checks.
  - `git diff --check`, privacy scan, stale-symbol scan, and current-base
    `git merge-tree --write-tree` proof.
- Expected outcomes:
  - All selected checks pass on the exact candidate; any unrelated blocker is
    named with the narrow reproducer and direct proof that the diff did not
    cause it.
- Results on the integrated candidate before PR creation:
  - Integrated current main through `fc954786c9` without conflicts, preserving
    its configurable Junction summary/timeseries resource ownership.
  - Focused Junction lifecycle/backfill proof: 1 file, 87 tests passed.
  - Assistant hosted-device-sync runtime: 1 file, 100 tests passed.
  - Hosted Web runtime authority, wake, migration, and Prisma source owners:
    4 files, 230 tests passed.
  - Full `@murphai/device-syncd`: 47 files, 1,079 tests passed.
  - Device-sync, assistant-runtime, and Web typechecks passed; Prisma schema
    validation and workspace package cycles passed. Device-sync package-boundary
    coverage is included in the green full package suite.
  - Workspace boundary verification reports an unchanged current-main sibling
    test import violation outside this branch's diff; current-main contains the
    same offending line.
  - Supported production runner assembly rebuilt workspace artifacts and passed
    all six parity probes. The vault bundle measured 9,086,709/9,100,000 total
    bytes and 791/20,000 entry bytes. The runner measured 1,701,391 entry bytes,
    8,088,219/8,088,470 static-closure bytes, and
    10,223,826/10,251,013 total bytes, with no budget ratchet.
  - Final diff check plus privacy, secret, local-path, and stale-symbol scans
    passed immediately before the scoped candidate checkpoint.
  - PR #1800's first clean release-app lane exposed one missing explicit Web
    source alias for the new public device-sync subpath. The package export was
    correct, but a prebuilt local `dist` had allowed focused Web typecheck to
    resolve it without the Web-owned alias. Adding the exact source mapping
    makes clean and prebuilt resolution agree; Web `typecheck:prepared` and the
    repo workspace-source-resolution suite (7 tests) pass after remediation.
  - Required GitHub Actions passed on pushed head
    `e46164ab9afafd14755b10c5612a89686081a30a` while the ReviewGPT gates ran.
  - Final uncommitted remediation proof: the three focused device-sync files
    passed 255 tests; assistant hosted-device-sync runtime passed 100 tests;
    scoped Web Prisma-source and hosted-wake files passed 139 tests; and the
    isolated migrated Postgres resilience file passed all 6 tests.
  - Device-sync, assistant-runtime, and prepared Web typechecks all pass on the
    remediation candidate. Workspace package-cycle verification passes.
    Workspace-boundary verification still reports only the origin/main-identical
    sibling Web-test import outside this diff.
  - The exact production runner assembly after remediation passed all six parity
    probes without a budget ratchet: vault total 9,086,709/9,100,000 bytes;
    runner entry 1,701,391 bytes; static closure 8,088,219/8,088,470 bytes; and
    total 10,223,826/10,251,013 bytes.
  - The hosted stale-residue guard, final diff check, and added-line secret,
    privacy, local-home-path, and email-identifier scans pass on the remediation
    candidate.
  - Final ReviewGPT round 2 used a fresh sensitive full snapshot of exact head
    `cf1229b6526daa87c4f017946cfb90907af1635a`. Two earlier staging attempts
    failed before send, and the prior round-1 URL was unavailable across managed
    profiles; the valid Mountain retry submitted once in a new full-audit
    conversation. Response capture reached its three-hour guard, then the
    read-only thread export recovered one substantive marked response with
    `ROUND_OUTCOME: RETROSPECTIVE_REQUIRED` and `REVIEW_COMPLETE`.
  - Independent validation reproduced the retrospective trigger: 35 admitted
    raw slugs produce 420 current-day keys and trip the 396-key store guard;
    alias epoch-one unpublished coverage survives canonical epoch-two
    pre-hydration clearing, suppresses replacement scheduling, and an old alias
    job reaches provider fetch. The PR body records the required retrospective
    and continuation decision before further remediation.
  - Final alias-ownership remediation proof passes: device-sync provider/store/
    service coverage is 4 files and 519 tests; assistant hosted-device-sync is
    1 file and 102 tests; hosted Web source/runtime/wake coverage is 3 files and
    226 tests; and the isolated real-Postgres resilience lane remains 6 tests.
    Device-sync, assistant-runtime, and prepared Web typechecks pass.
  - Workspace package-cycle verification passes. Workspace-boundary verification
    still reports only the unchanged sibling Web-test import already present on
    the candidate head and outside the PR-authored diff.
  - Production runner assembly passes all six parity probes without a budget
    ratchet: vault total 9,086,709/9,100,000 bytes and entry 791/20,000 bytes;
    runner entry 1,701,391 bytes, static closure 8,088,460/8,088,470 bytes, and
    total 10,238,240/10,251,013 bytes.
  - The hosted stale-residue guard, final diff check, and added-line credential,
    privacy, local-home-path, and email-identifier scans pass on the remediated
    candidate before its scoped commit.
  - Round-3 wire-presence remediation proof passes: the full assistant hosted
    runtime file passes 104 tests; the frozen pre-epoch Web parser lane passes
    10 tests with the new exact callback; device-sync and assistant-runtime
    typechecks pass; and every required GitHub Action passes on exact head
    `7b1b380cf60ca5c4c3203d63e70744369880b4d8`.
  - Round-4 fairness proof first reproduced the defect against the uncorrected
    scheduler: four hourly passes all selected the same dead reopened source.
    After the stateless selection correction, the regression passes with three
    reopened attempts followed by ordinary progress on the fourth slot; the
    complete Junction history file passes 98 tests and the device-sync
    typecheck passes.
  - Round-5 fairness proof first reproduced modulus aliasing against the
    uncorrected two-pool cadence: across eight real SQLite scheduler/store
    passes, one dead reopened coordinate and the same dead ordinary coordinate
    were selected while the second ordinary coordinate was never offered.
  - The corrected selector gives reopened and ordinary pools independent
    logical ordinals derived from the existing hourly cycle. The real-store
    reproduction passes; the production selector reaches every single-pool
    cardinality through 396 and every mixed-pool cardinality through 395,
    including factors shared with four; and the actual 33-source by 12-resource
    candidate set proves the 396-key bound plus active-key and completed-coverage
    suppression. The complete Junction history file passes 100 tests,
    device-sync typecheck passes, and `git diff --check` passes.
  - Round-6 remediation first reproduced the established-source race against
    the uncorrected implementation: reconnect-start left
    `local_connection_revision` at zero while the paused blood-pressure worker
    completed. After the atomic source-start fence, the focused race and two
    adjacent revision/source-start tests pass (3 tests), the complete service
    file passes 116 tests, the full device-sync package passes 1,101 tests, the
    device-sync typecheck passes, and `git diff --check` passes.
  - Round-7 remediation first reproduced both hosted variants: the Web
    source-start boundary left the parent connection timestamp unchanged, and
    hosted hydration retained target-source blood-pressure coverage after the
    reconnect fence. After correction, the full device-sync package passes 47
    files and 1,101 tests; the full assistant-runtime package passes 86 files
    and 2,290 tests with 4 skipped; the Web runtime-authority file passes 84
    tests; and the Web wake/store files pass 152 tests. Device-sync,
    assistant-runtime, and prepared Web typechecks pass, as does
    `git diff --check`. Workspace package-cycle and hosted stale-residue guards
    pass. The supported runner assembly passes all six parity probes without a
    budget ratchet: vault total 9,042,569/9,100,000 bytes and entry 791/20,000
    bytes; runner entry 1,701,375 bytes, static closure
    8,059,499/8,088,470 bytes, and total 10,222,270/10,251,013 bytes.
  - Round-8 complexity proof first reproduced 33 redundant full source-set
    reads after one owning transactional list across the catalog maximum. After
    deleting generic write-time reconciliation, the store/source regression
    passes 20 tests and records zero per-source collection reads. The composed
    real-Postgres apply records exactly one `DeviceConnectionSource.findMany`
    and 33 intended point upserts. A bounded legacy Apple alias admission
    advances epoch 7 to 8 without generic reconciliation; the next owning list
    preserves that authority and removes the loser once. The Web source,
    runtime-authority, and wake files pass 254 tests; the complete isolated
    migrated Postgres resilience/webhook files pass 9 tests; prepared Web
    typecheck and `git diff --check` pass.
  - Round-9 callback proof first reproduced the defect against the uncorrected
    handler: callback B advanced the exact source to epoch 2, but independently
    completed callback A left it at epoch 2 and retained B-lifecycle target
    coverage. After collapsing the connected/disconnected completion split,
    B advances to epoch 2, A advances to epoch 3, all twelve schedule-time
    coordinates clear exactly, source-first blood-pressure and sibling coverage
    remain, and each completion owns one signal and mailbox wake. A complementary
    pending-newer-start regression proves the older callback changes no source,
    coverage, signal, or mailbox state. The hosted wake, callback-proof, and
    callback-route files pass 166 tests, including two independent browser
    sessions bound to separate callback states. Prepared Web typecheck and
    touched-file lint pass. Static closure confirms the obsolete reconciliation
    export and dedicated error helper have no remaining source or test
    references; the stale-runtime guard, privacy scan, and `git diff --check`
    also pass.
  - Round-10 local callback proof first reproduced the repeated mechanism:
    independent callbacks B then A left the SQLite source at B's lifecycle and
    rejected A with `CONNECTION_SOURCE_START_STALE`. After both owners adopted
    one stateless callback-admission decision, B advances the source to epoch 4
    and A advances it to epoch 5, A clears all twelve target schedule-time
    coverage coordinates while preserving source-first blood pressure and a
    sibling provider coordinate, increments the existing account revision, and
    atomically adds exactly one initial job. The complementary pending-newer-
    start case still rejects without mutation.
  - The focused SQLite/service regression passes, the device-sync store,
    service, and public-ingress files pass 241 tests, and the hosted wake,
    callback-proof, and callback-route files pass 166 tests. The full
    `@murphai/device-syncd` test command exits successfully. Device-sync and
    prepared Web typechecks pass; the touched Web file passes its owning ESLint
    configuration. The hosted stale-residue guard, stale-helper scan, privacy
    scan, and `git diff --check` pass.
  - Round-11 physical-rekey proof first reproduced the bug on the unmodified
    comparator in a migrated Postgres database: the provider check was active
    and an owning source-list transaction replaced the alias row with a
    canonical row at unchanged lifecycle authority, but final admission left
    the source disconnected at epoch 1 and created none of the accepted work
    effects. After deleting the physical row ID from this proof, the same race
    advances epoch 1 to 2, clears all twelve target schedule-time coordinates,
    preserves target blood pressure and sibling Garmin weight coverage, settles
    the trace, and creates one dirty owner, signal, mailbox item, and wake.
  - The complete hosted webhook, source-store, and migrated-Postgres authority
    lane passes 175 tests, including the existing credential, epoch, fence,
    status, error, and timestamp supersession cases. Prepared Web typecheck and
    touched-file lint pass. The hosted stale-residue guard, targeted proof-owner
    inspection, privacy scan, and `git diff --check` pass.
  - Final ReviewGPT round 12 binds exact behavior head
    `1c01b72f56047aa692032d0a6bfce3c832750ccf`, the requested model, the
    package-owned response hash, `ROUND_OUTCOME: PASS`, and `REVIEW_COMPLETE`.
    Its full-patch audit found no remaining qualifying issue.
  - Round-13 integration proof first reproduced the defect at all three owner
    boundaries: local reconnect left `local_connection_revision` unchanged,
    hosted start skipped the parent-version boundary, and hosted runtime apply
    rejected or redirected an update away from the established opaque row.
    After correction, device-sync store/service passes 176 tests,
    assistant hosted runtime passes 107 tests, and hosted wake/runtime authority
    passes 248 tests. Device-sync, assistant-runtime, and prepared Web typechecks
    pass; `git diff --check` and the added-line privacy/identifier scan pass.
  - Round-14 remediation proof passes 271 focused hosted source-store, wake,
    and runtime-authority tests. The isolated migrated-Postgres authority file
    passes all 4 tests, including the established opaque Apple Health sequence
    across native reconnect, webhook epoch advance, provider disconnect, a
    lower-epoch deterministic duplicate, a second reconnect, and a final
    webhook. Prepared Web typecheck, touched-file lint, `git diff --check`,
    dependency policy, ignored-build inspection, and frozen dependency install
    pass. ReviewGPT CLI and registry latest both report `0.5.131`.
  - Round-15 remediation proof passes all 165 hosted-wake tests. The isolated
    migrated-Postgres authority file passes all 4 cases with its established
    opaque Apple Health source seeded connected before explicit native connect,
    then proves pending source start, webhook epoch advance, provider disconnect,
    bounded lower-epoch duplicate handling, reconnect, and final webhook. The
    ReviewGPT 0.5.132 package-contract test passes after aligning its version,
    configurable marked-response threshold, independent model-fallback constant,
    extracted fail-closed helper, and current README contract assertions.
  - Exact-head CI's assistant package shard also reported one timing-sensitive
    outbox assertion outside the latest diff. Its exact named test passes alone
    with 104 adjacent tests skipped, so no assistant production or test change
    is made for that unrelated flake.
  - ReviewGPT is updated to registry latest `0.5.132`; the frozen install,
    dependency policy, ignored-build inspection, and exact CLI package-contract
    test pass. Two round-16 preflights stopped before packaging or send because
    the optional local preference overwrote an explicit supported four-lane
    command value with the unsupported value five. The required Frog entry
    records the precedence defect and the bounded workaround: isolate optional
    local preferences for this invocation while retaining the repository's
    browser defaults and an explicit supported lane count.
