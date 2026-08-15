# Reconcile Junction compact timeseries collections

Status: active
Created: 2026-08-12
Updated: 2026-08-14

## Goal

- Resolve the accepted ReviewGPT findings on PR 1707 without adding another
  cursor, watermark, scheduler, or state owner.

## Success criteria

- Every scheduled reconcile refreshes the latest globally closed date for the
  six fidelity resources without widening the hourly all-resource fanout.
- Successful sparse fidelity resource jobs refresh daily totals for every
  globally closed provider date intersecting their precise window.
- Daily sums and dense feature envelopes reconcile non-empty complete-set
  growth and removal without treating a child-row revision as the collection
  revision.
- Stable sparse interval identities retain their explicit revision ordering and
  exact replays remain no-ops.
- Durable architecture and ingestion docs describe the implemented ownership.
- Focused tests, affected package typechecks/build, repository guards, required
  CI, and the routed ReviewGPT stopping condition pass.

## Scope

- In scope: Junction provider scheduling, compact timeseries normalization and
  core reconciliation, focused device-sync/importer/query coverage, and the
  owning architecture/ingestion docs.
- Out of scope: new persistent state, new transport resources, raw dense sample
  retention, or changes to unrelated providers.

## Tasks

1. [x] Delete the account-clock gate while retaining UTC-12 closure filtering
   inside the bounded daily importer.
2. [x] Remove derived max-child versions from daily and dense feature facts;
   retain revisions only on stable sparse interval records.
3. [x] Add store-level closure-race, non-empty complete-set growth/removal,
   stable-row, and exact-replay regression coverage.
4. [x] Align the architecture, importer, and ingestion-invariant owners.
5. [x] Reproduce and reject round six's proposed output-cap correction as a
   pre-existing integration-ingest limit, then clarify the durable contract.
6. [x] Remove round seven's synthetic-midnight temporal derivation, complete
   local proof, commit and push the exact candidate, then run required CI.
7. [x] Record the hard-cap retrospective and obtain an explicit continuation
   decision before any eighth ReviewGPT round.
8. [x] Land the bounded PR-schema and runner-bundle budget corrections and run
   round eight against the exact pushed head.
9. [x] Resolve round eight's sparse-correction and hourly-fanout findings, then
   run round nine against the exact pushed head.
10. [x] Resolve round nine's provider-day correction finding and recover the
    interrupted round-ten result.
11. [x] Resolve the recovered ledger gap by making sparse stable-ID equality
    include provider-day metadata, then rerun substantive round ten.
12. [x] Resolve round ten's cross-day receipt and transport-dedupe findings,
    then run round eleven against the exact pushed head.
13. [x] Resolve round eleven's durable calendar-refresh finding.
14. [x] Resolve round twelve's retained-job and authoritative-empty-day
    findings.
15. [x] Resolve round thirteen's lifecycle-boundary and applied-daily-state
    findings.
16. [x] Resolve round fourteen's strict complete-set and reconnect-wake
    complexity findings.
17. [x] Resolve round fifteen's lossy production-parser calendar finding.
18. [x] Resolve round sixteen's grouped-source alias finding.
19. [x] Resolve round seventeen's end-to-end alias-equivalence finding.
20. [x] Resolve round eighteen's account-owned source identity finding.
21. [x] Resolve round nineteen's split persisted-source authority finding.
22. [x] Resolve round twenty's hosted exact-key precedence finding.
23. [ ] Obtain exact-head green CI and a ReviewGPT PASS, then merge and retire
    the task worktree.
24. [x] Stop the review loop at the user-authorized round-twenty-two cap and
    resolve its final reconnect-authority finding without starting round
    twenty-three.
25. [x] Resume the review loop under the user's explicit 2026-08-14 direction,
    integrate current `main`, resolve its Junction ownership conflicts, and
    restore focused green proof before round twenty-three.
26. [x] Resolve round twenty-three's yielded sparse-history repair loss and
    unclosed broad-continuation publication findings without adding another
    queue, frontier, or state owner.
27. [x] Resolve round twenty-four's post-import sparse-day ownership recurrence
    through one shared finalization boundary, prove the accepted day and
    malformed-row retry leave the executor together.
28. [x] Resolve round twenty-five's date-mode UTC-prefix data-loss finding.
29. [ ] Resolve round twenty-six's hosted cold-start source-identity finding,
    then obtain exact-head green CI and ReviewGPT PASS.

## Decisions

- The scheduled pull floor remains unconditional, but its timeseries work has
  two bounded cadences: one latest-closed-day pass for the six fidelity
  resources every reconcile, and the prior seven-day all-resource correction
  sweep only after the account crosses a UTC day.
- Successful sparse fidelity resource jobs return the canonical importer's
  provider-local day keys and atomically enqueue one existing durable resource
  job for each closed corrected date. Each continuation calls only the existing
  calendar-day importer, so retry and yield progress survive later revisions
  without a second queue, store, scheduler, or aggregate owner.
- A child-row timestamp cannot order the complete resource/day collection.
  Serialized canonical event-spine reconciliation is the existing owner for
  unversioned daily and dense feature facts.
- Sparse stable-row revisions remain useful because they order one durable
  identity rather than a changing set.
- Ordinary empty provider collections do not emit aggregate tombstones. An
  exact source/day sparse calendar repair treats a successful empty response as
  an authoritative zero sum through the existing daily event identity; an
  optional or unavailable endpoint remains retryable and cannot claim success.
- ReviewGPT round six's global-output finding is pre-existing rather than
  PR-caused: the proposed 11,522-event reproduction also fails the unchanged
  base integration-ingest contract, and live imports always persist a complete
  output list. Expanding that contract is outside this fidelity change.
- ReviewGPT round seven's date-only temporal finding is accepted. Date-only
  dense rows remain daily facts but cannot become temporal samples; their
  complete-day feature owner publishes zero coverage so stale clock-derived
  facts clear without another state owner.

## Hard-cap retrospective

- The original requirement remains one bounded six-resource outcome: retain
  exact sparse timing and truthful compact dense temporal shape without raw
  sample retention or another canonical/state owner.
- The first-reviewed patch had 2,030 source additions and 38 deletions. The
  remediated patch has 2,483 source additions and 68 deletions; the cumulative
  first-head remediation is 513 additions and 90 deletions. Round seven's fix
  contributes 67 source additions and 5 deletions, with no new owner, queue,
  cursor, watermark, schema family, dependency, or persisted state.
- Deleting the temporal feature path would abandon the requested glucose,
  oxygen, and stress outcome. Merely skipping date-only envelopes would strand
  prior clock-derived facts. The smallest complete correction is therefore the
  current provider-clock admission check plus an empty envelope through the
  existing feature identity.
- Decision: continue with this bounded correction, then pause at the seven-round
  hard cap. Do not start round eight until the user explicitly chooses to
  continue after reviewing this retrospective.
- The user explicitly authorized round eight on 2026-08-12 while directing the
  agent to make CI green and merge. The known CI corrections remain metadata
  schema completion plus measured bundle-budget ratchets; neither adds product
  behavior or a runtime owner.
- Round eight's two review-induced findings are accepted. Restoring the prior
  daily broad-sweep gate and reusing the existing calendar importer for hourly
  fidelity catch-up and sparse correction adds no state owner, queue, cursor,
  watermark, dependency, or service.
- Round nine's review-induced finding is accepted. Precise sparse corrections
  now select calendar refreshes from transient canonical provider-day evidence
  instead of UTC execution-window dates. The existing import receipt and
  calendar importer carry the evidence and perform the refresh, so the fix adds
  no persisted state, queue, cursor, watermark, dependency, or service.
- The interrupted round-ten response was recovered as `INVALID`, so it does not
  advance the review counter. Its prior-ledger gap exposed an unresolved earlier
  accepted finding: sparse stable-ID equality omitted persisted day, timezone,
  offset, and timestamp-semantics metadata. The importer now reuses its existing
  full fidelity record key as the content fingerprint, deleting the narrower
  duplicate fingerprint without adding an identity owner or state.
- The valid round-ten retry's two review-induced findings are accepted. Core's
  existing supersession boundary now returns the bounded union of displaced and
  incoming provider days through the existing transient import result and
  receipt. Fidelity transport dedupe now retains the importer-owned provider-day
  and timestamp-semantics fields instead of adding another conflict comparator.
  Neither correction adds persisted state, a queue, a scheduler, or a second
  revision owner.
- Round eleven's review-induced finding is accepted. A transient multi-date
  refresh could lose an older failed source day after a second correction, and
  yield restarted the precise job instead of advancing calendar work. The
  existing atomic job-completion path now persists one deduplicated resource
  continuation per closed affected date. A 64-day cap rejects excessive fanout
  before the core write and is rechecked before enqueue. This reuses the
  existing device-job queue and calendar importer; it adds no store, schema,
  service, scheduler, cursor, watermark, or aggregate owner.
- Round twelve's two review-induced findings are accepted. Calendar repair jobs
  now reuse the existing retained accepted-work predicate in the store and
  service, extending the attempt fence when a retryable failure or expired
  lease consumes it. A later matching obligation renews the same deduplicated
  row. Successful HTTP 200 empty source/day responses now pass an explicit zero
  aggregate through the existing calendar importer and canonical event spine;
  optional 404/422 endpoints remain retryable. Source identity travels on the
  bounded existing job payload, so this adds no schema, queue, service,
  scheduler, cursor, watermark, tombstone API, or second aggregate owner.
- Round thirteen's two review-induced findings are accepted. Calendar repair
  jobs now remain on the same retained queue row across setup, disconnect,
  reauthorization, source fencing, and credential-epoch replacement. Authority
  loss delays the job without provider I/O; reconnect wakes only rows delayed
  for missing authority. Completion now requires the existing canonical import
  receipt to contain the exact source/resource/day daily identity, so a
  nonempty response that normalizes to no owned fact remains retryable. This
  adds one lifecycle exception and one receipt assertion, not another queue,
  store, service, scheduler, cursor, watermark, or aggregate owner.
- Round fourteen's correctness finding is accepted. Exact calendar repair now
  validates every target row before the canonical write; a mixed-validity
  response cannot commit a partial daily collection merely because one row
  emitted the expected identity. Its complexity-collapse finding is also
  accepted: reconnect wake is one set-based SQLite update instead of an
  account-wide row collection plus per-job JSON parsing and updates. The strict
  mode is an ephemeral snapshot expectation and adds no persisted owner; the
  SQL correction deletes the unbounded collection path.
- Round fifteen's production-path finding is accepted. Exact provider/date
  calendar fetches now require structurally complete grouped or ungrouped
  collections before filtering, empty-set synthesis, or canonical write. A
  discarded non-object group or sample raises the same retryable retained-job
  failure; genuinely empty exact-source results retain the existing zero path.
  The correction reuses the existing bounded client/provider call tree and
  adds no state owner, queue, worker, schema, cursor, watermark, or dependency.
- Round sixteen's alias finding is accepted. Strict parsing no longer filters
  an outer grouped key before the existing row-origin and source-admission path
  normalizes it. This deletes a second comparison rule, so supported Apple
  Health separator aliases reach the established exact-source filter while
  malformed groups remain retryable.
- Round seventeen's end-to-end alias finding is accepted. The calendar path now
  reuses the existing connect route as its single equivalence owner for live
  authority and row selection, queries the route's canonical target, and
  projects selected rows onto the job-owned historical identity before strict
  import. No alias table, migration, or second identity comparator was added.
- Round eighteen's identity finding is accepted. The provider now resolves one
  established account source before precise or calendar normalization, reuses
  its persisted spelling and source key to derive canonical event provenance,
  and rejects multiple route-equivalent source rows as ambiguous. Source
  projection updates that same row instead of minting an alias row. This adds
  no alias registry, migration, queue, or persisted state owner.
- Round nineteen's review-induced identity finding is accepted. Hosted
  hydration and job-time source listing now preserve the same established
  local source key and provider spelling across route-equivalent aliases.
  Routine calendar, dense direct, precise correction, and retained repair
  imports all project rows onto that persisted authority. Legacy duplicate
  route-equivalent rows choose the oldest keyed row deterministically instead
  of failing every retry. This reuses the connect-route owner and existing
  source rows; it adds no alias registry, migration, queue, schema, or second
  identity owner.
- Round twenty's review-induced finding is accepted. Hosted job-time listing
  still preferred a later duplicate's exact hosted key before the older
  route-equivalent local source that hydration and provider projection already
  treated as authoritative. Junction job listing now selects the established
  route-equivalent source first and collapses multiple hosted alias entries to
  one projected source. This is one precedence correction and one bounded
  in-memory dedupe in the existing listing owner; it adds no persisted state,
  migration, alias registry, queue, service, or lifecycle machinery.
- Round twenty-one's review-induced finding is accepted. The round-twenty
  dedupe selected the oldest alias row as a whole, coupling stable source
  identity to potentially stale lifecycle state. Job-time listing now keeps
  the established source key, spelling, and first-seen time while selecting
  lifecycle authority by the same last-data-then-last-seen progression used by
  hosted hydration. Equally authoritative aliases with conflicting state fail
  retryably. The correction stays inside the existing bounded listing owner and
  adds no store, registry, migration, queue, service, or reconciliation loop.
- Round twenty-two's review-induced finding is accepted. Treating
  `lastDataAt` as stronger lifecycle authority could preserve an old disconnect
  fence over a newly accepted reconnect until the reconnect delivered data,
  which the stale fence itself prevented. Hosted hydration and job-time listing
  now share one consolidation rule: newest `lastSeenAt` owns lifecycle state,
  equal-timestamp conflicts fail retryably, and `lastDataAt` merges separately
  as monotonic arrival evidence. The correction replaces the two divergent
  rules with one package-local helper and adds no persisted state, manager,
  queue, scheduler, registry, service, or reconciliation loop.
- On 2026-08-14 the user explicitly superseded the prior round-twenty-two stop
  boundary and directed the lane to continue through conflict resolution,
  ReviewGPT PASS, merge, and completion. The current-main integration keeps
  the branch's six-resource calendar-fidelity owner while adopting `main`'s
  bounded per-resource continuation path for broad collections.
- Round twenty-three's review-induced findings are accepted. Every successful
  yielded precise-history chunk now returns its already-proven provider-day
  repair jobs beside the existing precise continuation, so the current atomic
  completion/enqueue transaction retains both obligations. Broad calendar
  continuations project offset cursors onto complete UTC-day request windows
  and skip only a terminal day beyond the existing UTC-12 closure frontier.
  The correction reorders existing result construction and derives one local
  request window; it adds no queue, persisted frontier, scheduler, worker, or
  state owner.
- Round twenty-four's control-flow recurrence is accepted. The atomic unit is
  a canonical closed provider day proven by a successful precise-import
  receipt: after that receipt exists, every successful executor return must
  transfer the day to the existing retained calendar job owner. For a mixed
  valid/malformed response, retain the proven day immediately while the
  malformed precise work keeps its existing delayed retry; withholding the
  already-committed valid intervals would require widening the canonical import
  transaction and would discard useful exact evidence. One post-import
  finalizer therefore covers normal completion, yield, malformed-row retry,
  retryable partial collection, and authority-transition exits. This reuses the
  existing receipt, resource-job queue, calendar importer, and atomic
  completion/enqueue transaction; it adds no queue, state, worker, scheduler,
  cursor, or frontier.
  Its proposed disconnect-loss reproduction is rejected after direct store and
  service proof: the current SQLite disconnect predicate retains the ordinary
  Junction resource retry as queued, so the claimed dead-retry/shifted-floor
  path does not occur. The regression therefore stays at the actual boundary
  and proves the accepted calendar day and malformed-row retry are returned
  together, without adding a contrived lifecycle test.
- Round twenty-five's review-induced finding is accepted. Junction's one-date
  endpoint can represent a row with a UTC timestamp plus separate provider
  offset, so comparing the raw UTC prefix with the requested provider date can
  silently remove part of an otherwise complete calendar response before the
  importer sees it. The existing calendar-owned and extended-daily date branch
  now retains the endpoint's complete response and leaves provider-local day
  resolution with the importer. Floating activity aggregates keep their prior
  trim, so the fix does not broaden non-calendar ownership. This changes no
  state, queue, cursor, service, parser, or retry mechanism.
- Round twenty-six's review-induced finding is accepted. Hosted hydration
  consolidated route-equivalent aliases by lifecycle state alone before the
  empty machine-local store could preserve an established source identity.
  The first production-path regression failed in both hosted snapshot orders:
  hydration selected the newer alias key, spelling, and first-seen time while
  retaining only the older alias's monotonic last-data evidence. Hydration and
  job-time listing now reuse one identity-plus-lifecycle consolidation helper:
  earliest valid first-seen time and deterministic key/spelling own identity,
  newest last-seen time owns lifecycle, and last-data time merges separately.
  Empty-store hydration retains the selected hosted identity's exact key instead
  of deriving a new alias key. This deletes the two divergent comparison and
  dedupe implementations and adds no persisted state, migration, queue, worker,
  retry family, lifecycle owner, or compatibility path.

## Verification

- Passed focused store-level regression proving pre-closure suppression,
  higher-priority resource completion, and post-closure daily import.
- Passed focused query regression proving same-max set growth, lower-max set
  removal, paired daily/feature publication, and exact-replay collapse.
- Passed all 222 Junction provider tests, all 164 Junction importer tests, and
  all 20 normalized wearable-surface tests.
- Passed affected `core`, `importers`, `device-syncd`, and `query` typechecks,
  the importer build, scenario-manifest integrity, and `git diff --check`.
- Reproduced ReviewGPT round six's proposed 11,522-event historical batch and
  proved it fails the base branch's pre-existing 10,000-output integration
  ingest contract; no out-of-scope contract expansion was retained.
- Round seven returned one original-PR finding: date-only dense readings were
  assigned synthetic midnight temporal evidence. Focused importer and canonical
  query regressions now prove provider-clock-only derivation and stale temporal
  fact removal.
- Passed the final scoped importer/query suites, affected typechecks and importer
  build, docs drift, scenario integrity, privacy scan, and `git diff --check`.
- The mechanically merged candidate passed 223 provider, 171 importer, 21 query,
  105 device-sync service, and 32 core reconciliation tests; affected package
  typechecks/builds and required CI also passed. A current-main merge-tree proof
  remained clean after the base advanced again.
- The PR architecture schema now passes with its explicit complexity-avoidance
  item. The runner bundle budget-policy suite passes 42 tests, and exact local
  production assembly passes at 9,952,950B total and 7,927,638B static closure
  with the existing narrow allowances retained.
- Round eight found that precise sparse corrections could leave old daily sums
  stale and that the unconditional calendar import had widened hourly work to
  all configured resources across seven days. Focused tests reproduce both
  mechanisms and now prove exact-interval plus daily correction, six-resource
  one-day hourly work, and retention of the once-daily broad sweep.
- Passed all 223 Junction provider, 105 device-sync service, 171 Junction
  importer, and 21 normalized wearable query tests; the device-sync typecheck,
  docs drift, scenario integrity, and production runner assembly also pass. The
  final runner bundle is 9,955,082B against the 9,985,718B budget.
- Round nine found that a UTC-normalized sparse correction window could refresh
  no date or the wrong date when the corrected interval belonged to a
  negative-offset provider day. The regression now proves that canonical
  provider-day evidence selects April 2 for an April 3 UTC execution window,
  deduplicates two corrected rows on that date, and waits until the exact UTC-12
  closure boundary before issuing the daily refresh.
- Passed the exact remediation's 223 Junction provider and 105 device-sync
  service tests, the device-sync typecheck, docs drift, scenario integrity, and
  production runner assembly. The runner bundle is 9,956,920B against the
  9,985,718B budget.
- Recovered round ten from the existing ReviewGPT thread as `INVALID`: the
  prompt omitted the earlier sparse stable-ID provider-day metadata finding.
  A production-shaped both-order regression reproduced the input-order bug,
  then passed after the importer reused the full fidelity record key. A strictly
  newer explicit revision now also selects the newer provider-day metadata in
  either payload order.
- The valid round-ten retry found that a cross-day stable interval correction
  refreshed only its incoming day and that fetch-side first-win dedupe could
  hide provider-day conflicts before importer validation. Both production-path
  regressions failed before remediation and now pass: the first reports both
  affected days through importer and core, while the second rejects both input
  orders for calendar-date and timestamp-semantics conflicts. Exact correction
  replay also retains both days, so a failed calendar follow-up remains
  retryable without persisted repair state.
- Passed the final 177-test core device-import file, 174-test Junction importer
  file, 329-test Junction provider/service files, and 21-test normalized query
  file; owning package typechecks, importer build, docs drift, scenario
  integrity, and `git diff --check` pass. The dependency-aware `test:diff` run
  also passed all affected package and app phases before the retry-proof
  tightening; the final focused rerun covers that narrow core result change.
- Round eleven found that accepted calendar refresh work existed only in a
  transient loop. A v1/D1 to v2/D2 correction whose D1 refresh failed could be
  followed by v3/D3, after which stale v2 replay could no longer reconstruct
  D1. The remediation tests prove each immediate core transition, prove stale
  replay has no older-day evidence, and prove the durable failed D1 job remains
  queued while later D2/D3 jobs coalesce and complete. Calendar-job yield now
  re-enqueues the same day without refetching the precise window, and a 66-day
  correction set rejects atomically at the 64-day bound.
- Passed 179 core device-import tests and 398 combined Junction provider,
  provider-manifest, device-sync store, and device-sync service tests plus the
  owning package typechecks after round-eleven remediation. The provider test
  also proves the 64-day receipt bound fails before calendar provider-call
  fanout, while the manifest tests prove the durable day survives hosted hints
  and enqueue normalization.
- The dependency-aware `test:diff` run passed every affected package and app
  phase until the hosted-web production build encountered a transient Google
  Fonts fetch failure. Repeating that exact hosted-web build succeeded with all
  244 pages and runtime checks. The remaining Cloudflare verification then
  passed its typecheck, 2,406 node tests, and 11 Workers tests.
- Round twelve found that ordinary calendar jobs could dead-letter after five
  attempts or an exhausted expired lease, and that an authoritative empty
  calendar response completed without clearing the displaced daily total. The
  focused regressions now prove same-row lease reclamation beyond the attempt
  fence, three service-level canonical import attempts from `maxAttempts: 1`,
  explicit zero-sum replacement on HTTP 200 empty, and retry retention for an
  optional 422 response. Source/day target fanout remains capped at 64 before
  core persistence and before job enqueue.
- Passed the final 175-test Junction importer file, 784-test core suite, and 402
  focused device-sync provider/store/service/manifest tests plus the owning
  package typechecks, importer build, 7-test changelog-fragment suite, docs
  drift, scenario integrity, and `git diff --check` after round-twelve
  remediation.
- Round thirteen found that account/source lifecycle cleanup could still erase
  retained calendar work and that a nonempty HTTP 200 response could complete
  after normalization emitted no owned daily fact. Focused regressions now
  prove dormant setup/disconnect/reauthorization handling without provider I/O,
  source-fence retention and reconnect wake on the same job, account-cleanup
  and credential-epoch preservation, exact daily receipt admission, retry for
  invalid nonempty rows, and authoritative-empty success.
- Round fourteen found that the exact-ID receipt could still certify a partial
  daily total when one valid row survived beside a malformed row, and that the
  reconnect wake helper used an uncapped read/parse/update loop. Focused proof
  now rejects mixed-validity calendar snapshots before core import, retries the
  same retained job, succeeds after a fully valid response, preserves
  authoritative empty success, and selects reconnect wake rows through one
  set-based mutation.
- Round fifteen found that the production HTTP client could discard non-object
  groups or samples before round fourteen's validator and then certify a
  partial or false-empty collection. Focused production-fetch proof now rejects
  grouped mixed-validity, grouped all-invalid, and ungrouped mixed-validity
  responses before canonical import; the service-level retry uses the same row
  and a later complete response applies the full daily value.
- Round sixteen found that strict parsing compared the outer grouped key before
  established source normalization, so a supported hyphenated Apple Health key
  could be dropped and replaced with an authoritative zero. Focused
  production-fetch proof now covers all three admitted spellings plus an
  unrelated valid group, imports the real value, and emits no zero marker.
- Round seventeen found that the remaining live-source, query, filter, and
  importer boundaries still compared raw spellings. A 27-case production-fetch
  matrix now proves every Apple Health job/listing/group spelling cross-product
  in hosted `listed_only` mode, canonical provider query selection, unrelated
  group exclusion, real-value import, and preservation of the job-owned daily
  identity.
- Round eighteen found that route-equivalent aliases could still mint separate
  interval and daily identities after passing admission. Focused provider proof
  now preserves one established source row and opaque canonical source identity
  across a provider-listing alias change, emits calendar work under that
  identity, and fails closed on duplicate route-equivalent source rows. A real
  importer/core replay proves a value and D1-to-D2 correction stays on one
  revision spine, reports both affected days exactly once, and ignores a stale
  replay without new work.
- Passed the final device-sync typecheck and all 995 device-sync tests after
  narrowing source-identity projection to the precise and calendar paths. The
  21 normalized wearable-query regressions, owning importer/core/query
  typechecks, importer build, docs drift, scenario integrity, targeted privacy
  scan, and `git diff --check` also pass. The full Junction importer file's one
  unrelated timeout passed when rerun alone, including the new real-core alias
  replay regression.
- Round nineteen found that precise imports, routine calendar imports, and
  retained repairs could each derive provenance from a different execution or
  hosted connection identifier. Focused provider, hosted hydration, and
  real-core regressions now prove one opaque persisted source key survives
  Apple Health alias changes, value correction, D1-to-D2 migration, retained
  D1/D2 repair, and stale replay on one interval/daily identity spine.
- Passed all 996 device-sync tests, all 178 Junction importer tests, and all 92
  hosted runtime device-sync tests. The affected device-sync, assistant-runtime,
  and importer typechecks, docs drift, 204-scenario integrity check, targeted
  privacy-path scan, and `git diff --check` also pass. The precise path reuses
  its pre-fetch persisted authority for retry evidence and one post-fetch
  source reread for both admission and canonical projection, so the correction
  adds no extra post-fetch state round trip.
- Round twenty reproduced the remaining split with an older established local
  Apple Health source, a later route-equivalent duplicate whose key exactly
  matched the hosted snapshot, and two hosted alias entries. The hosted
  hydration/job regression now proves hydration keeps the established row,
  job-time listing returns that same key and spelling exactly once, and the
  provider's routine, precise D1-to-D2 correction, and retained repair paths
  stay on that identity even when both persisted rows remain present. The
  existing real-core stale-replay proof remains on the same canonical spine.
- Round twenty-one remediation passes the assistant-runtime typecheck, all 92
  hosted runtime device-sync tests, and all 234 Junction provider tests. The
  extended hosted regression proves that disconnect and reconnect state win by
  lifecycle authority in opposite alias orders while the established identity
  remains stable, and that equal-authority state conflicts stay retryable.
  Docs drift, the 204-scenario integrity check, scoped privacy scanning, and
  `git diff --check` also pass.
- Round twenty-two remediation passes the assistant-runtime typecheck and all
  92 hosted runtime device-sync tests. The expanded production-path regression
  proves a fresh disconnect beats older connected data, a reconnect with no new
  data beats the old fence while retaining historical arrival evidence, both
  alias orders agree across hydration and job listing, and equal lifecycle
  conflicts fail before source mutation.
- The 2026-08-14 current-main integration passes all affected package
  typechecks plus 272 Junction provider tests, 180 Junction importer tests, 101
  hosted device-sync runtime tests, 22 normalized wearable query tests, and 42
  runner-bundle budget tests. Docs drift, 206-scenario integrity, provider
  request boundaries, dependency installation, and both staged and unstaged
  `git diff --check` passes are green.
- Round twenty-three was recovered from its accepted ChatGPT thread after the
  original response-capture step failed. It returned one High yielded-repair
  loss and one material unclosed-day publication finding. Focused regressions
  pass for both paths, all 273 Junction provider tests pass, the device-sync
  and Cloudflare typechecks pass, the 42-test bundle-budget file passes, and
  provider request boundaries plus 206-scenario integrity remain green. The
  exact Linux CI runner measurement is retained with the existing 32KB
  allowance.
- Fresh exact-head CI passed every required check plus the frontend, hygiene,
  billing, viewport, and Cloudflare sandbox workflows. Its non-required
  platform-coverage shard exposed three stale PR test models: the direct
  executor helper abandoned the durable calendar siblings intentionally
  emitted beside yielded precise continuations, and a scheduled-reconcile test
  expected ordinary resource jobs to advance the full-sync clock despite the
  established preservation rule. The helper now drains deduplicated immediate
  calendar siblings while retaining the precise result, importer receipts
  mirror production calendar-target evidence, malformed sparse coverage proves
  that only the repaired 120 mg complete-day total publishes, and the reconcile
  regression advances its clock through the pre-closure full-job continuation.
  The exact three-test reproduction and four-test follow-up pass, both full
  affected files pass 200/200, and the device-sync typecheck passes.
- Round twenty-four returned `RETROSPECTIVE_REQUIRED`: the yielded-path fix did
  not cover the earlier mixed-validity retry return, so a successfully imported
  sparse day could still lack immediate calendar ownership. Its asserted
  disconnect-loss path was disproved because the ordinary precise retry remains
  queued; the accepted correction instead makes the actual executor result
  return that retry and its calendar repair together. Pending: finish focused
  proof, integrate current `main`, obtain exact-head green CI and ReviewGPT
  PASS, then merge and retire the worktree.
- The round-twenty-four mixed-validity regression passes alone and the full 80
  test Junction extended-history file passes. The device-sync package
  typecheck and `git diff --check` pass. A direct service/store reproduction
  proved the ordinary retry remains queued across disconnect, so the rejected
  lifecycle scenario was removed instead of adding test-only machinery around
  a false premise.
- Integrated current `main` at `9aff00cd7d` with one inspected conflict pair:
  both runner-bundle files take `main`'s newer Browser Vault/Query measured
  baselines. The 42 runner-budget tests, Cloudflare and device-sync typechecks,
  all 80 extended-history tests, docs drift, provider request boundaries, the
  206-scenario integrity check, and the post-merge merge-tree proof pass.
- Exact-head Linux runner assembly then measured the combined current-main plus
  fidelity graph at 10,465,027 bytes. Only the total measured baseline is
  ratcheted to that value with the existing 32 KiB allowance; entry, static,
  and forbidden-input guards are unchanged, and the 42-test budget proof passes.
- The non-required platform coverage shard exposed equal-priority test ordering:
  two retained calendar rows were due at the same instant, but the regression
  asserted which random job ID claimed first. The intended first row now has
  explicit priority. The focused regression and all 50 store tests pass; no
  production behavior changed.
- Round twenty-five reproduced the UTC-prefix loss before remediation: a
  provider-date response totaling 120 retained only 80 when one negative-offset
  row crossed into the next UTC date. The sparse production-path regression now
  passes for both offset directions across extended history, retained calendar
  repair, and reconcile. The dense regression passes scheduled-resource and
  reconcile execution in both orders and proves each daily mean and compact
  feature envelope retains both crossing samples. Both full affected provider
  files pass 355/355, the device-sync typecheck passes, and `git diff --check`
  passes.
- Round twenty-six's cold-start regression failed before remediation in both
  newest-first and oldest-first hosted snapshot orders, selecting the newer
  alias identity instead of the established key. Both cases now pass and prove
  one local source uses the oldest identity, newest lifecycle/error state, and
  maximum last-data time; job-time listing returns that same identity. All 103
  hosted device-sync runtime tests and the assistant-runtime typecheck pass.
