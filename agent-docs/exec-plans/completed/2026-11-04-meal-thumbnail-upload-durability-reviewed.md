# Meal thumbnail upload durability — reviewed implementation

Status: completed
Created: 2026-11-04
Updated: 2026-11-04

## Goal, scope and review gate

End the retention loop and preserve meal deletion through every ambiguous upload,
receipt and crash outcome, without adding reply-path waits or re-uploading legacy
media. Preserve original-photo expiry, receipt replay, mailbox imported/handled
boundaries, write fences and complete cleanup pointers. Retention-wait tuning and
other media lifecycles are out of scope.

Baseline: PR #4544 at `dd811e73e0`; the uncommitted C prototype is evidence, not an
approved implementation. Read [round 1](../../../audit-packages/pr-4544-round-1.md)
and [the parking comment](https://github.com/cobuildwithus/murph/pull/4544#issuecomment-6638462386).
The completed plan with this basename is immutable historical evidence; this
active plan supersedes its foreground recovery and legacy-marker decisions.
**Before implementation:** obtain ReviewGPT plan review, record each finding's
accept/reject disposition with code/test evidence, and obtain the parent's go-ahead.
Round-1 High is accepted: the publisher awaits PUT before saving its pointer;
registration clears expiry; operation-derived retries abandon the unknown object.

## Decision: durable ownership, then bounded idle delivery

Revise C to reuse the existing **idle maintenance** owner, after a canonical
receipt is durably published and before the final full snapshot. Remove C's
network recovery from restore and its unconditional post-snapshot upload loop.
“Committed receipt” means an accepted Web status CAS references the receipt log,
not merely a successful artifact PUT. The existing maintenance boundary publishes
that CAS without the foreground coalescer (`workspace-runner.ts:1570,3095,3180`;
`hosted-runtime.ts:7090,7940`). If that proof is absent/ambiguous, do not upload.

Design-review references below are relative to `packages/assistant-runtime/src/hosted-runtime/`
unless otherwise qualified; their line numbers describe the reviewed prototype.
The implementation references and verification record below describe the final tree.

```text
Today: canonical mutation -> thumbnail PUT/register(null) -> catalogue
       -> receipt/artifacts -> Web receipt-log CAS -> full snapshot -> Meals replica
Proposed: canonical mutation + pending pointer + thumbnail bytes in receipt
       -> receipt/artifacts -> accepted Web receipt-log CAS -> release canonical lock
       -> idle-only register(null) -> PUT -> mark delivered locally
       -> existing full snapshot saves completion/cursor -> Meals replica
Cold: accepted snapshot + ALL published receipts replay -> foreground first
       -> idle recovery of still-live pending holders -> existing checkpoint
Delete pending: canonical deletion -> retain cleanup pointer -> idle register(due finite)
       -> acknowledged retire -> remove pointer -> ordinary snapshot
```

No non-expiring object precedes its durable cleanup identity. Register **before**
PUT once durable: an interrupted multipart upload must not inherit the provisional
65-minute lifetime and become a terminal identity before recovery. Web already
supports this order (`apps/web/src/lib/hosted-execution/runtime-media.ts:90–104`).
Check live canonical holder/path/hash/size before effects; replay deletion always
wins. Keep bytes in receipts/snapshots. Retain both newly prepared pointers and
older cleanup pointers until pruning acknowledges deletion (`media-references.ts:104–136`).
Remote effects run outside the canonical lock; short local marker updates recheck
the same identity. Late replies after cancellation cannot clear/replace pointers.

### Data and old-runner compatibility

Use the existing encrypted media catalogue and receipt `mediaRef`:

```text
new canonical path: raw/meals/<opaque>/thumbnail-v2-<operationId>.jpg
entry: existing descriptor + pendingUpload?: boolean
catalogue: existing schema/entries + mealUploadCursor?: <mediaId>
```

Only this writer creates the `thumbnail-v2-` namespace; today's SHA/operation
filenames cannot match it. Identity remains the existing path/hash/size/kind hash,
so the Meals API derives the correct ID without Web changes. New entries start
pending; successful acknowledged PUT sets false. Receipt replay reconstructs
pending for v2 paths. Missing marker means **pending only for v2 paths**; legacy
paths without the marker remain settled. Never scan/re-upload legacy objects to
infer readiness. No bulk backfill or new schema version/table is needed.

At `dd811e73e0`, `parseHostedMediaReference` drops unknown fields; the matching
entry branch reconstructs descriptors and suppresses PUT (`media-references.ts`,
base lines 677–704 and 536–574). Old writers therefore drop `pendingUpload` and
the cursor, **do not re-upload a matching live entry**, and keep its pointer.
Their snapshot reconciliation prunes entries only when no live candidate remains.
However, it writes the reduced catalogue BEFORE DELETE. A failed retirement can
therefore erase cleanup ownership on a later warm checkpoint: old runners are
not a safe rollback floor while cleanup remains pending.
A pending image may stay unavailable throughout rollback. On rollforward, the
v2 path survives in canonical state/catalogue/receipts and reconstructs intent;
only v2 entries may repeat a bounded upload. Existing legacy entries never become
pending. Test the actual old parser/publisher round trip, not a hand-written mock.

### Foreground isolation and bounds

Run delivery after the existing `maintainMealPhotos` durable callback returns
(`idle-maintenance.ts:517–531`), in both normal and retention-only invocations.
Skip it for pending foreground/assistant work, unsafe receipt recovery, shutdown,
or owner handoff. A pending-only restore joins the ordinary idle-checkpoint
obligation **after foreground has finished**, including the otherwise-clean
return path; it adds no restore upload or admission prerequisite and does not
shorten the existing reply idle floor.

One budget object per invocation, shared across retention-loop iterations:
**at most 10 attempted thumbnails and 2 seconds total delivery wall time**,
whichever is reached first; no in-pass retries. Start the clock at first idle
attempt. Register and PUT are serial; select after the saved cursor, advance it
before attempting, and wrap once. A failed effect advances the cursor so later selected entries get another turn.
Discovery must finish before any effect; sustained preemption or a ledger that
cannot be traversed within the budget can still defer delivery/cleanup. Reuse the current wake/abort-and-re-notify mechanism
(`idle-maintenance.ts:143–158`). Add optional cancellation context to media
`record`/`put`/`delete` (`platform.ts:303`, `apps/cloudflare/src/runtime-platform/media-store.ts:127,229,514`)
and pass it into the existing abortable HTTP helper (`hosted-http.ts:13`).

Race the idle caller with foreground wake/budget cancellation; never join a late
network response on admission, checkpoint quiescence, or assistant start. Every
continuation checks cancellation before another effect/local write. Existing
server write fences, multipart drains and terminal retirement handle remote
completion after local cancellation. Merely putting the current C loop inside
`runOptionalPostCheckpointWork` is insufficient: that wrapper does not preempt on
foreground wake (`hosted-runtime.ts:7461`).

Publish a future delivery retry with the receipt-log CAS before effects; save
incomplete work and the cursor through the existing full checkpoint. Merge a
one-hour delivery retry into the existing `inbox_media_retention` wake, taking the
minimum with real photo-expiry/other existing deadlines. Reuse the current hourly
failure cadence; do not introduce a delivery-only keep-alive wait. Ordinary idle
work may recover sooner. This preserves deletion deadlines but can defer a
budget-limited thumbnail for up to that retry opportunity.

## Failure matrix and required proof

The implemented regressions use real core/receipt/snapshot owners and a media
adapter with absent-retirement 409, terminal retirement, finite sweep and late
null registration. Names below refer to the runtime test files in verification.

| Shape | Mechanism | Passing regression (parameters abbreviated) | Red evidence |
| --- | --- | --- | --- |
| (i) acknowledged PUT, receipt fails, rollback, retirement | Fresh v2 operation path avoids the old terminal identity; new writes defer PUT until receipt publication. | `acknowledged upload and failed receipt converge after retirement (receiptStored=%s)` ×2; warm/cold artifact variants | Both fail on `01de16157c` with terminal HTTP 409 |
| (ii) registered PUT loses response, retry, delete | Durable pointer, same-ID idle retry, acknowledged cleanup. | `a lost media reply leaves no orphan when the next action is retry`; `lost registered PUT response remains deletable: retry/cold_retry` | `dd811e73e0` leaves one object |
| (iii) registered PUT loses response, deletion before retry | Current-holder check forbids PUT; finite registration and terminal retirement remove the owned object. | `a lost media reply leaves no orphan when the next action is delete_immediately`; `lost registered PUT response remains deletable: delete_first/cold_delete_first` | Main and `dd811e73e0` leave one object |
| (iv) crash after PUT before receipt/full snapshot | PUT before published receipt is unreachable; receipt-only cold restore recovers a PUT with ambiguous completion. | `failed receipt publication rolls back without obstructing snapshots`; `lost registered PUT response remains deletable: cold_retry/cold_delete_first` | New ordering assertion; old orphan failure covered above |
| (v) receipt commits, crash before full snapshot | Restore bytes/pointer without media effects, then deliver only in idle. | `receipt-only cold recovery waits for idle and survives the provisional grace window` | New durability guarantee |
| (vi) receipt response lost although stored | Unpublished artifacts authorize nothing; an actually published receipt log wins after cold restore. | `failed receipt publication rolls back without obstructing snapshots (stored=true)`; `lost receipt publication acknowledgement restores the actually published log before delivery`; stored-receipt bridge/artifact variants | Stored-receipt incident fails on main |

For every applicable row: warm and cold variants, snapshot reconciliation,
successful retry where appropriate, meal deletion and final prune; entire store
empty. Keep registration-response-loss, partial PUT beyond 65 minutes, rejected
snapshot, stale replay after deletion, prune failure, and new cold-ingest upload
plus failed thumbnail prune cases. C's existing regression fails on
`dd811e73e0` with one orphan in both lost-response variants; deterministic base
recovers (ii) but fails (iii). Re-run red on original main `01de16157c` for (i)/(iii)
and on `dd811e73e0` for (ii), then green on the implementation. Ordering tests for
new guarantees need not pretend to be baseline bug reproductions.

Additional gates: a never-settling PUT/registration plus injected foreground and
assistant wake must reach admission **before** the deferred network promise
settles; no lock is held, no later effect starts. Prove 10/2-second invocation
bounds across multiple maintenance iterations, cursor fairness, zero legacy PUTs,
old/new/old/new catalogue round trips, and no repeated upload after completion
is checkpointed. Verify full-photo expiry while delivery fails.

## Production sizing and delivery timing

Aggregate-only reads on 2026-11-04 UTC: 121 active registered non-expiring images
across 20 members, 21,766,282 total bytes. `hosted_runtime_media` has kind/hash/size
and opaque object key, **no meal subtype or vault path** (Prisma schema:1471;
`packages/hosted-execution/src/storage-paths.ts:80`). These rows include other
saved images; they are conservative meal-media bounds, not exact meal counts.
Percentiles use the 20 members with candidate rows; they are not meal-only-positive
cohort percentiles. Only the per-member supersets and absolute maxima bound meal media.

| Per-member upper-bound population | Max | p90 | Median |
| --- | ---: | ---: | ---: |
| Count | 22 | 18 | 2 |
| Bytes | 5,682,407 | 3,629,570 | 181,479 |

```sql
WITH per_member AS (
 SELECT user_id, count(*) n, sum(byte_size) bytes FROM hosted_runtime_media
 WHERE media_kind='image' AND registered AND expires_at IS NULL
   AND retired_at IS NULL AND purged_at IS NULL GROUP BY user_id
)
SELECT max(n), percentile_disc(.9) WITHIN GROUP (ORDER BY n),
 percentile_disc(.5) WITHIN GROUP (ORDER BY n), max(bytes),
 percentile_disc(.9) WITHIN GROUP (ORDER BY bytes),
 percentile_disc(.5) WITHIN GROUP (ORDER BY bytes) FROM per_member;
```

Current C could add up to 44 awaited registration/PUT calls for the count bound;
the proposed legacy path adds **zero**. Exact meal-only percentiles cannot be
obtained from this table without decrypting/classifying catalogue data; that is
not authorized by this aggregate-only investigation. No payloads were read.

Before: thumbnail GET becomes readable after pre-receipt PUT; the companion gets
its URL once the browser Meals replica includes the thumbnail. After: GET becomes
readable after the post-receipt idle PUT; normal replica publication still follows
that pass/full checkpoint (`hosted-runtime.ts:7631`). No extra full snapshot is
required before delivery, and successful normal idle batches preserve first-view
ordering. Existing image GETs remain direct Worker/R2 reads; the Meals API never
wakes a runner (`companion-meals.ts:137,149`; `ios-meals.md:228–265`).

**Visible tradeoff:** preemption, budget exhaustion, recovery or rollback can let
a replica expose a URL before bytes are ready: image GET may return 404 until
idle retry, while meal metadata remains usable. This can regress thumbnail
availability in those cases; do not claim zero view regression. Full meal photos,
inbox images/videos, ordinary/generated captures and cold-ingest upload timing
remain unchanged. Original-photo retirement cannot depend on delivery success.

## Minimal machinery and rejected alternatives

Added pieces, each necessary: pending bit (ambiguity recovery); v2 path marker
(old writers erase the bit, legacy absence must stay settled); one catalogue
cursor (a repeatedly timing-out head must not starve later work under the budget);
transient invocation budget plus cancellation plumbing (reply priority); existing
wake/checkpoint integration (pending-only restores and completion must converge).
Keep the receipt pointer and pre-PUT registration (crash recovery and avoiding
provisional retirement). No new queue, table, scheduler, generation chain or
lifetime-promotion protocol. Remove prototype restore uploads/startup completion
flag and the unconditional snapshot upload hook.

- **G:** lost PUT -> rollback -> meal deleted before retry -> no catalogue pointer
  and no generation walk; null expiry excludes A from sweep. Additionally the
  Meals API derives g0, so g>0 requires reader changes. The g0 failure is reproduced.
- **(a) provisional until commit:** receipt committed -> container dies before
  promotion -> 65-minute sweep terminally retires A -> promotion/PUT cannot
  revive it. Fixing this requires identity replacement and canonical reader
  updates or an atomic promotion/publication contract, plus Worker/Web skew work.
- **D, local pointer-before-PUT with existing ordering:** PUT registers -> container
  dies before receipt/snapshot -> local pointer disappears and A is immortal.
  Persisting that pointer remotely first is already the ordering change proposed.
- **Prototype C:** correct ownership but unbounded foreground recovery and implicit
  legacy pending create the demonstrated latency risk. Its hooks are not shipped.

## Rollout, verification and tasks

Deploy runner/container via normal Cloudflare deployment, including the local
media-client cancellation change. No Web/Temporal/schema deploy: HTTP descriptors,
ID derivation and event-code vocabulary remain compatible. Evacuate old warm
writers through the normal release mechanism. During rollback an old runner can
delay pending v2 delivery and drop markers/cursor; rollforward reconstructs them
from paths. Rollback reintroduces old writers' precommit-upload bug for their new
writes; it is not a privacy-safe long-term operating mode. Their existing
failed-prune behavior also remains old behavior; do not promise it is fixed by
a newer reader. Preserve the existing thumbnail-capable reader rollback floor.

The affected workspace's next ordinary retention wake creates a fresh v2 path,
publishes its receipt, retires expired originals canonically, then delivers in
idle. No operator mutation should be needed for the known incident. Existing
objects whose pointers were already lost are a separate inventory/repair question;
this release cannot discover them from opaque media rows and must not delete
legacy non-expiring images indiscriminately.

As of 18:37 UTC, the last 30 days contain 38 matching failures for one subject;
14 occurred after the stated release boundary. Add numeric retirement/upload/
pending counters to the existing buffered `runtime.invocation_finished` record
(`hosted-runtime.ts:1463`), only when an idle pass ran, with no synchronous telemetry
call. Pending counts must reflect remaining live intent, not default to zero on
invocations that skipped maintenance. Existing completion
counts are stdout-only; the dedicated log query found none. This small addition
proves successful retirement rather than merely absence of failures.

Run this aggregate query through `murph-prod-runtime-logs-psql-ro`, substituting
the actual deployment instant; never output the cohort's subject keys:

```sql
WITH b AS (SELECT timestamptz '<DEPLOY_UTC>' t), cohort AS (
 SELECT DISTINCT subject_key FROM hosted_runtime_log,b
 WHERE at >= b.t-interval '30 days' AND at < b.t
   AND event_code='runtime.retention_issue' AND error_code='runtime_error'
   AND redacted_json->>'stage'='meal_photos'
)
SELECT event_code, count(*) events,
 sum((redacted_json->>'mealFullPhotosRetired')::int) retired,
 sum((redacted_json->>'mealThumbnailUploadsCompleted')::int) uploaded,
 min((redacted_json->>'mealThumbnailUploadsPending')::int) pending
FROM hosted_runtime_log JOIN cohort USING (subject_key) CROSS JOIN b
WHERE at >= b.t AND at < b.t+interval '24 hours'
 AND ((event_code='runtime.invocation_finished'
       AND redacted_json->>'runtimeReleaseSha'='<DEPLOYED_SHA>') OR
      (event_code='runtime.retention_issue' AND redacted_json->>'stage'='meal_photos'))
GROUP BY event_code;
```

Expected: a new-release retention completion with retired > 0 and eventual
pending = 0; no further meal-photo failures/hourly failure chain after convergence.
Confirm the completion's existing `runtimeReleaseSha` equals the deployed SHA;
no new-version completion means **not yet verified**, not success.

1. Parent/ReviewGPT review this plan; disposition findings before code changes.
2. Implement the reviewed idle owner, durability gate, v2 compatibility and bounds;
   replace the prototype hooks, retain its useful failure tests, add matrix tests.
3. Run focused runtime artifact/bridge/receipt-entrypoint/restore-preparation/
   cold-ingest/idle-maintenance suites; core meal-photo maintenance; Cloudflare
   runtime-media upload/private-media/client cancellation; Web companion Meals.
   Run `pnpm --dir <package> typecheck` for core, assistant-runtime, Cloudflare and
   Web; `pnpm complexity:diff`, docs drift and `git diff --check`.
4. Parent owns implementation review, CI, deployment and the aggregate convergence
   query. Closing this implementation plan does not claim production verification.

The parent accepted the delivery budget, hourly fallback, compatibility strategy
and published-receipt boundary through the review disposition below. Exact
meal-only sizing and retroactive unknown-object repair remain scope limitations.

## ReviewGPT plan review (2026-11-04)

Parent accepted every finding and authorized implementation. Review evidence:
`audit-packages/plan-meal-thumbnail-upload-durability.md`.

- **P1 accepted; runner-only composition selected.** For obsolete pending v2
  pointers only, register the exact descriptor with already-due finite expiry,
  then retire without uploading. Retirement acknowledgement alone completes
  cleanup. Registration failure still permits retirement while authorized;
  cancellation/owner loss forbids further effects. Run both in abortable idle
  maintenance, never inside locked snapshot pruning; retain unacknowledged
  pointers in snapshots. The Web alternative is not strictly smaller: retire
  carries only mediaId (`runtime-media.ts:25,65` in hosted-execution), whereas
  the existing table requires kind/size/hash and constrains kind. Correct exact
  tombstones require propagating a descriptor through Web/Worker/runtime or
  introducing placeholder metadata semantics. Existing runner record/delete
  already have the required descriptor and cancellation owner, with no skew gate.
- **P2a accepted.** Select bounded pending v2 catalogue entries first; validate
  latest holders with interruptible event-ledger traversal only, excluding inbox
  inventory. Start the shared deadline before preparation. Partial discovery
  authorizes neither upload nor obsolete-pointer retirement.
- **P2b accepted.** Replay preserves false only for an exact path/ID/kind/hash/size
  match; otherwise infer pending for v2 only. Legacy absence stays settled.
- **Explicit criteria accepted.** Persist retry through the existing
  inboxMediaRetentionWakeAt CAS before effects, including pending-only recovery;
  preserve earlier actual deadlines. Projected assistant deadlines interrupt the
  retention-only delivery phase. Cancellation covers authority lookup, in-flight
  waits, cached registration and completion bookkeeping, not just fetch.

Add production-faithful absent-retire 409, terminal rejection, finite sweep and
late-null-registration fixtures, plus P1 ambiguity/crash/interruption tests,
large-history discovery, replay completion, skew and budget tests. Parent owns
shipping; no commit/push is authorized. Availability can remain deferred under
repeated preemption; the hourly retry is not a readiness SLA.


## Implementation and verification (2026-11-04)

P1 uses runner-only finite registration plus terminal retirement. Web's current
retire command contains only an ID; the database requires kind/hash/size/object
key. An atomic unseen-row tombstone would need a richer cross-service command or
placeholder schema semantics. Reusing record/delete avoids both. Network work
runs in the idle owner; snapshot pruning only retains pending pointers. No
restore upload, startup completion flag or unconditional snapshot upload hook
remains. A short acknowledged status CAS before the idle batch also covers
pending-only recovery; the receipt CAS independently publishes retry ownership.

Implementation owners: `meal-media-maintenance.ts` selects/validates/settles at
most ten pending v2 descriptors with one clock/cancellation context; core chooses
the v2 path; `canonical-write-media.ts` preserves exact-identity completion;
`media-references.ts` retains cleanup pointers; runtime-state preserves the cursor;
`idle-maintenance.ts`/`hosted-runtime.ts` own admission, retry and numeric progress;
Cloudflare's media client fences every continuation and releases canceled waits.
No inbox inventory, new queue, table, schema or scheduler was added.

Verification commands (repository root; all fixtures synthetic):

```sh
pnpm exec vitest run --config packages/assistant-runtime/vitest.config.ts --no-coverage packages/assistant-runtime/test/hosted-{meal-media-maintenance,runtime-artifacts,invocation-bridge,runtime-cold-ingests,runtime-cold-ingest-system-mailbox,runtime-retention-wake-loop,runtime-idle-maintenance,runtime-pending-input-protected-idle-maintenance,runtime-canonical-write-receipt-log,runtime-workspace-entrypoint-receipts,workspace-restore-preparation}.test.ts
pnpm exec vitest run --config packages/core/vitest.config.ts --no-coverage packages/core/test/meal-photo-maintenance.test.ts
pnpm exec vitest run --config packages/runtime-state/vitest.config.ts --no-coverage packages/runtime-state/test/hosted-media-references.test.ts
pnpm exec vitest run --config apps/cloudflare/vitest.config.ts --no-coverage apps/cloudflare/test/{runtime-media-write-cancellation,runtime-media-upload,private-media}.test.ts
pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/device-sync-companion-meals-route.test.ts apps/web/test/changelog-page.test.tsx
DATABASE_URL="$LOCAL_POSTGRES_URL" MURPH_TEST_POSTGRES_CONCURRENCY=1 pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/hosted-runtime-owner-postgres.test.ts -t 'media|orphan grace'
# LOCAL_POSTGRES_URL was a dedicated loopback database, migrated with:
DATABASE_URL="$LOCAL_POSTGRES_URL" pnpm --dir apps/web prisma:migrate:deploy
for package in packages/core packages/assistant-runtime packages/runtime-state apps/cloudflare apps/web; do pnpm --dir "$package" typecheck; done
pnpm complexity:diff
pnpm docs:drift
git diff --check
```

Red proof used temporary exact production-source replacement in this worktree,
with byte-for-byte restoration in `finally`, and the unchanged bridge regressions:
`vitest ... hosted-invocation-bridge.test.ts -t 'a lost media reply'` on
`dd811e73e0`: **2 failures**, each final store size 1; on `01de16157c`, adding
`|acknowledged upload and failed receipt`: **3 failures / 1 pass** (lost reply
with immediate deletion; both receipt failure variants). This separately proves
the original deterministic retry loop and the operation-name orphan regression.

Actual old-code proof loaded `git show dd811e73e0:packages/assistant-runtime/src/hosted-runtime/media-references.ts`
as a temporary test module, with only its relative imports relocated. Two actual
old/new publisher round trips retained the v2 identity, dropped marker/cursor as
expected and caused **zero PUTs for 100 legacy entries**. A second sequence
confirmed the old failed-prune rollback hazard: retirement failed, the pointer
was already gone, and a later old snapshot left one unlimited object. The probe
passed its expected assertions and was removed from the source tree; sanitized
probe source/logs remain under `.tmp/meal-media-validation/` for parent review.
The permanent compatibility regression retains the old serialized field shape.

Focused P1 proofs include absent rows, stored-but-lost finite registration,
lost retirement acknowledgement, already-terminal rows, finite sweep after a
crash, late null registration before/between/after cleanup, and owner loss.
Preemption proofs cover before/after network awaits, retry CAS, integrity reads,
an early live match followed by large unrelated history and a deletion in a
later shard, never-settling transports, authority lookup, shared PUT waits,
cached registration and completion bookkeeping. The real entrypoint yields to
foreground notification and a projected assistant deadline without notification,
while retaining an earlier real expiry. Other gates cover ten fast failures,
shared ten-attempt budget, two-second timeout/cursor progress, replay preserving
completion after a real full-photo-expiry receipt, and legacy zero-PUT behavior.

Product UX: **Ready for parent implementation review**, with the accepted
availability tradeoff. Ordinary success delivers before the Meals replica;
interrupted or budget-limited recovery can expose a URL returning 404 until a
later idle attempt. Metadata and canonical/CLI image reads remain available;
full-photo expiry does not wait for delivery. API tests cover legacy and v2
paths; recovery tests cover warm/cold reads, deletion and missing delivery.
The hourly retry is an opportunity, not a one-hour readiness SLA. Sustained
preemption, slow discovery or infrastructure failure can extend the 404 window.
Changelog: updated, `2026-11-04/meal-photo-cleanup-recovery`; content-only existing
archive presentation, verified by the fragment generator and archive test.

Deploy: runner/container via normal Cloudflare release; no Web protocol/schema
or Temporal deployment dependency. Web publishes only the release-note content.
New runner + old Worker/Web uses existing commands and descriptors. Evacuate old
warm writers normally. Keep the corrected runner as the rollback floor for
pending cleanup: old/new live catalogue compatibility does not make old failed
pruning safe. No production mutation, commit, push or deployment was performed.
Existing unowned legacy objects require separate scoped inventory/repair; this
change cannot discover them or safely sweep all null-expiry image rows. The
retention-wait cap remains unchanged. Parent owns CI, final review and post-deploy
verification using the aggregate query above.


Final verification: **PASS** — 309 runtime tests (11 suites), 30 Cloudflare tests
(3 suites), 39 Web route/archive tests (2 suites), 15 selected real-PostgreSQL
media-owner tests (71 unrelated cases deselected), 4 core tests, 2 runtime-state
tests, and the one-off actual-old-code compatibility/rollback probe. All five
package typechecks passed. Complexity passed with no increased debt; docs drift,
privacy scan and `git diff --check` passed. No requested local check was blocked.
Full CI, deployment and production convergence were not run or claimed.

Source delta from `dd811e73e0`: **+365 / -35, net +330 lines**, including the new
183-line idle owner. Source changes, with final-tree references:

| File (repository-relative) | Added / removed | Reason |
| --- | ---: | --- |
| `packages/core/src/domains/events/meal-photo-maintenance.ts:114` | +4 / -4 | Distinguish v2 deferred delivery and avoid legacy retired identities. |
| `packages/assistant-runtime/src/hosted-runtime/meal-media-maintenance.ts:26` | +183 / -0 | Bounded idle selection, interruptible holders, live delivery, obsolete cleanup and retry merge. |
| `packages/assistant-runtime/src/hosted-runtime/media-references.ts:95` | +46 / -8 | Prepare v2 intent; preserve cursor and cleanup pointers through failed pruning. |
| `packages/assistant-runtime/src/hosted-runtime/canonical-write-media.ts:201` | +8 / -0 | Preserve completed exact identities during receipt replay. |
| `packages/assistant-runtime/src/hosted-runtime/idle-maintenance.ts:203` | +13 / -0 | Run delivery under existing preemption; report per-item failures after the bounded pass. |
| `packages/assistant-runtime/src/hosted-runtime.ts:7075` | +54 / -7 | Wire both idle modes, actual retry CAS inputs, pending-only work and numeric progress. |
| `packages/assistant-runtime/src/hosted-runtime/platform.ts:303` | +3 / -3 | Optional cancellation context on media writes. |
| `packages/runtime-state/src/hosted-media-references.ts:37` | +3 / -1 | Preserve the catalogue cursor at its shared reader. |
| `apps/cloudflare/src/runtime-platform/media-store.ts:201` | +51 / -12 | Cancel authority/shared-upload/cached-registration/transport waits and late bookkeeping. |

Tests changed file by file: `hosted-meal-media.harness.ts` supplies the faithful
owner adapter; `hosted-meal-media-maintenance.test.ts` proves the failure matrix,
bounds, discovery and replay; `hosted-invocation-bridge.test.ts` carries the
baseline-compatible red/green cases and snapshot no-upload guarantee;
`hosted-runtime-artifacts.test.ts` retains warm/cold prototype cases with explicit
idle ownership and absent-retire errors; `hosted-runtime-cold-ingests.test.ts`
protects newly uploaded history during failed thumbnail pruning;
`hosted-runtime-retention-wake-loop.test.ts` proves actual retry CAS inputs and
foreground/projected-deadline preemption; Cloudflare
`runtime-media-write-cancellation.test.ts` covers client continuations; Web
`hosted-runtime-owner-postgres.test.ts` verifies the real lifecycle composition;
Web `device-sync-companion-meals-route.test.ts` covers v2 capabilities. Docs update
`ARCHITECTURE.md`, this plan and `agent-docs/index.md`; the sole release-note file
is `apps/web/changelog/entries/2026-11-04/meal-photo-cleanup-recovery.json`.
Historical completed prototype/generation-evaluation plans remain unchanged.
Completed: 2026-11-04
