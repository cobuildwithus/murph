Goal (incl. success criteria):
- Collapse Junction push (webhook direct-import) and pull (windowed fetch) into an additive model where neither path gates/defers/disables the other, and delete the path-selection/gating/chunking machinery that was the recurring silent-data-loss class.
- Success: (1) no webhook execution branch can complete without import-or-fetch (eliminate E4 silent-complete); (2) the scheduled reconcile is an unconditional pull floor and the sole owner of source projection, min-only scheduled so no direct import can defer it (last_seen_at can never freeze); (3) ~-1k net lines deleted (gating predicates, oversized-payload chunking, direct-resource batch machinery); (4) no carrier removed for any push-only cell (garmin sleep, deletions stay inline-primary); (5) durable ingestion-invariants doc + compatibility-matrix push-only column.

Constraints/Assumptions:
- Mandate: radical simplicity, default to deletion, fewest branches/concepts/hidden behaviors; accept the redundant floor-fetch (Junction reads unmetered, merge idempotent on stable resourceId) and DELETE the redundancy-avoidance optimization rather than preserve it. Re-add a skip only if fetch volume is later MEASURED to be a problem.
- AGENTS.md hard rules: no `as any`, public entrypoints only, no secrets/identifiers in logs/fixtures/output.
- Idempotent merge confirmed: core upserts on `externalRef.resourceId` (explicit Junction id for summary; resource/source/timestamp for timeseries) → push-then-pull overwrite is overlap-free.
- Branch off `junction-webhook-resource-inference-fix` (PR #87 hotfix). Worktree must be named `murph-*` (assistant-engine path test + e2e harness).

Key decisions (the corrected design — Candidate B):
- Inline webhook records → IMPORT ONLY (no synchronous fetch). Empty/unknown/oversized webhook → DEGRADE TO THE DIRTY RECONCILE FLOOR (reuses existing `device_sync_dirty_connection`/`_payload` coalescing; do NOT emit a per-resource fetch job per webhook — that would fight storm-coalescing).
- The pull floor (scheduled `reconcile`/`backfill` via `executeJob` non-resource arm) does windowed fetch + `projectJunctionSources` on cadence. Projection rides the floor ONLY — do NOT add it to the direct-import path (preserves the deliberate `user/providers` decoupling from completed/2026-05-29-junction-direct-import-provider-list.md). last_seen_at stays fresh because the floor runs unconditionally.
- Single scheduling seam: `clampWebhookJobNextReconcileAt` (junction.ts ~:1303) is the sole writer of nextReconcileAt for every non-floor completion (min-only). The floor writes `now+interval` directly (the cadence advance); min-clamp on all other paths means a direct import can never push it out.
- Push-only matrix: every deletion is a GATE removal, never a CARRIER removal. Inline import (C2/E1/E2) is RETAINED; only the gating that decides import-vs-skip is deleted. Garmin sleep + deletions/tombstones stay inline-primary (REST stale/empty); all other cells pull-capable. UNCONFIRMED cells default to safe (keep inline + floor).

Terminal-branch spec ("no branch completes without import-or-fetch"):
- Construction (buildJunctionWebhookJobs ~:4200): C1 connection.* → backfill+reconcile (fetch); C2 data.* + resolved resource + inline json → resource jobs w/ payload (import); C3 data.* + resolved resource + no json → resource job (fetch); C4 no resolved resource → reconcile (fetch).
- Execution (executeResourceJob ~:1107 / executeJobBatch ~:689): E1 direct import (import, no projection — OK, floor projects); E2 batch direct (import); E3 unconfigured→event-type fallback (fetch, hotfix); **E4 unconfigured + no fallback → silent-complete w/ skip metadata — THE ONLY REMAINING IMPORT-OR-FETCH-FREE BRANCH, eliminate in P2**; E5 timeseries fetch (import/empty + project); E6 summary fetch (import + project); E7 empty resource → empty import + project; B1 executeJob reconcile/backfill = the floor (fetch + project).

Deletion list (all in packages/device-syncd/src/providers/junction.ts unless noted; grep-verified no external dependents except optional service.test.ts batch case):
- Gating: canImportJunctionWebhookDataJobRecord (usefulness arm), hasJunctionWebhookDataJobRecords, hasUsefulJunctionWebhookSummaryDataRecord, expandJunctionWebhookSummaryDataRecords, expandJunctionWebhookTimeseriesDataRecords (if unused after), readJunctionWebhookGroupedRecordEntries.
- Batch: describeJobBatch, executeJobBatch, readJunctionDirectResourceJobBatchInput, buildJunctionDirectResourceJobBatchKey, descriptor `batch:` block, JUNCTION_DIRECT_RESOURCE_JOB_BATCH_MAX_JOBS/_MAX_BYTES, type JunctionDirectResourceJobBatchInput. (batch? optional in types.ts:681, guarded in service.ts:800 → removing compiles, falls back to per-job executeJob.)
- Chunking/size-cap: JUNCTION_WEBHOOK_DATA_JOB_JSON_MAX_BYTES + the >MAX_BYTES→null guards in parseJunctionWebhookDataJobRecord/buildJunctionWebhookDataJobJsons/serializeJunctionWebhookDataJobRecord (oversized → [] → degrade-to-floor).
- KEEP (normalization/provenance, not gating): resolveJunctionWebhookDataRecordSourceProviderSlug, readJunctionWebhookNestedRecordEntries, inferJunctionWebhookResource (post-hotfix safe), resolveConfiguredJunctionEventTypeResource, importer-shared path descriptors in packages/importers.

Ingestion invariants (for the durable doc, P4):
1. Pull is a floor not a fallback: scheduled reconcile fires on cadence unconditionally, sole owner of projection; completions move nextReconcileAt only earlier (min-only), never later.
2. Push delivers early; pull guarantees eventually; neither disables/defers/gates the other.
3. Unknown input degrades to fetch, never to silence: any "nothing to do" webhook branch marks the connection dirty for the floor. No silent-complete terminal branch exists.
4. Idempotent merge on externalRef.resourceId makes overlap free → exclusivity unnecessary.
5. Louder never quieter: drops surface as persisted device-sync.job_failed/skip metadata (PR #84), but observability is not recovery — the floor recovers the data.

Phases (green & shippable each step):
- P1 (verify/finish hotfix): confirm clampWebhookJobNextReconcileAt is the sole non-floor nextReconcileAt writer (routes: ~:1183,:1213,:1253,:726,:1696); confirm floor is sole projector + runs on cadence; do NOT add projection to direct path. Tests: min-only scheduling assertion (direct import after earlier scheduled reconcile leaves earlier time intact) + "floor refreshes last_seen_at while only direct imports occur". Verify: device-syncd test:coverage + typecheck.
- P2 (eliminate E4): replace the E4 silent-complete (~:1153-1158) with degrade-to-floor — mark the connection dirty for a reconcile over the event window (use the existing reconcile/dirty path, NOT a unique-window resource job per webhook), keep the persisted skip log as the louder signal. After P2 the terminal-branch table has zero import-or-fetch-free branches. Tests: table-driven over webhook fixtures (enriched sleep, unknown discriminator, no-payload, oversized, meal) asserting each ends in import-or-fetch; incident replay still passes. Verify: device-syncd coverage + typecheck + hosted device-sync e2e lane.
- P3 (delete machinery): delete the Section-4 symbols; buildJunctionWebhookDataJobJsons keeps producing inline jsons minus the usefulness gate (parse+provenance only); oversized → [] → degrade-to-floor; remove descriptor batch block. Migrate/delete tests pinned to deleted gates; keep/repoint Garmin direct-sleep tests. Verify: full device-syncd coverage, test:diff device-syncd + apps/web/test/device-sync-*, typecheck, e2e lane.
- P4 (docs): new agent-docs/operations/device-sync-ingestion-invariants.md (the 5 invariants) + index it; add push-only column to docs/device-provider-compatibility-matrix.md (garmin sleep/deletions push-primary; bump Last verified); finish-task archive.

Risks/regressions:
- Storm-coalescing (primary): P2 degrade-to-floor must emit a coalescible reconcile dirty-resource (null-window) via buildHostedWebhookDirtyResources, NOT a unique-window job per webhook. apps/web/test/device-sync-hosted-wake.test.ts must still show one wake per clean→dirty transition.
- user/providers re-coupling trap: do NOT add projectJunctionSources to E1/E2. Add a test asserting direct import does not call listUserProviders.
- Garmin/push-only: inline import stays primary; floor fetch may return empty (harmless). Do not delete inline import for these.
- Timeseries raw-only: keep fetchTimeseriesResourceInChunks daily windowing (fetch windowing ≠ deleted payload chunking).
- Meal (just added, completed/2026-06-09): pull-capable; add to P2 fixtures.
- Backfill: P2 degrade uses reconcile NOT backfill (don't perturb historical-backfill state machine).
- Version skew (resource logic in BOTH apps/web parse + runner): new webhook jobs are a superset of old fields; old runner ignores unknown, new runner handles old jobs. Safe both orders; DEPLOY runner bundle (Cloudflare) before/with apps/web (Vercel). Add DEPLOYMENT CONCERNS to each PR.

State:
- P1 + P2 complete (this PR). P3 (deletion) and P4 (docs) follow as separate reviewed PRs. Machinery (gating/batch/chunking) intentionally retained until P3.

Done:
- Design pass complete (current-surface map, push-only matrix, candidate comparison → Candidate B, deletion quantification, phasing).
- P1 verified (no code change needed): clampWebhookJobNextReconcileAt (junction.ts:1303) is the sole nextReconcileAt writer for every non-floor completion (routes :726 batch, :1164 E4, :1199 E1 direct-import, :1229 timeseries, :1269 summary, :1696 yielded-resource). The floor — executeJob reconcile/backfill arm (:673) — writes now+interval directly (cadence advance) and is the sole projectJunctionSources caller (:598) alongside the fetch-based resource paths (:1125); the direct-import path (E1) does NOT project (preserves the user/providers decoupling). Lifecycle writers (:470 link seed, :514 connection complete, :580 createScheduledJobs) are connection setup, not completions.
- P2 done: E4 (executeResourceJob unconfigured-resource + no event-type fallback, ~:1161) no longer silent-completes. It now emits a day-floored coalescible `reconcile` scheduledJob (buildWindowJob) over the event window — degrade-to-floor — while keeping the persisted skip log as the louder signal. Burst webhooks coalesce on the shared dedupe key to one floor wake. Terminal-branch table re-verified: zero import-or-fetch-free branches remain.
- Tests: junction-webhooks.test.ts extended (5→14): min-only clamp, floor-owns-projection + no listUserProviders on direct import, table-driven import-or-fetch over enriched-sleep/meal/no-payload/unknown-discriminator/unconfigured/oversized fixtures, and a storm-safety coalescing guard (proven to fail on a non-coalescing exact-window follow-up). device-syncd test:coverage green (38 files, 614 tests); device-syncd + apps/web typecheck green.

Now:
- P1 + P2 shipped. Awaiting main-session review of this PR.

Next:
- P3 deletion PR (delete Section-4 gating/batch/chunking symbols; oversized → [] → degrade-to-floor), then P4 docs.

Open questions (UNCONFIRMED if needed):
- Exact enriched `daily.data.sleep.created` discriminator value (payloads deleted post-ack) — non-blocking; safe defaults cover it. Optional probe: apps/web parse-time resource log on next sleep webhook, or Junction support.
- Whether garmin deletions/tombstones currently route through the direct-import arm — non-blocking (safe default keeps inline).

Working set (files/ids/commands):
- packages/device-syncd/src/providers/junction.ts
- packages/device-syncd/test/junction-webhooks.test.ts, junction-provider.test.ts
- apps/web/src/lib/device-sync/wake-service.ts (verify coalescing), packages/device-syncd/src/{store/sync-state,service}.ts (read-only verify)
- pnpm --dir packages/device-syncd test:coverage; pnpm typecheck; hosted device-sync e2e lane
