# Query projection: one immutable SQLite file per section

Status: completed
Updated: 2026-11-10

## Outcome

Each query projection section (`entities`, `metrics`, `wearables`) becomes its
own SQLite file that is written once and never modified. Publication builds a
new file beside the old one and renames it into place. Readers open files
read-only. Query results, row contents and public output do not change.

This removes the in-place replace machinery: `DELETE`, `secure_delete`, the
write-ahead log, `VACUUM`, lazily created section tables, per-section table
guards and the unsupported-store reset.

## Why

Measured on a real 87 MB vault (2,879 entities, 33,397 metric points, 2,645
wearable rows; arm64, Node 24, medians of 7):

| Step, replacing a published store | Today | Section files |
| --- | --- | --- |
| `DELETE` of old rows (pages zeroed) | 54 ms | none |
| Inserts | 203 ms | 203 ms |
| `COMMIT` into the write-ahead log | 33 ms | folded into file write |
| `VACUUM` | 65 ms | none |
| Total | 356 ms | 220 ms |

Bytes written for a full publication of 32 MB of rows: about 160 MB today
(log, checkpoint, `VACUUM` copy, its log and checkpoint) against 33 MB.

In production the SQLite write is 12.5% of rebuild time (4.9 s of 39.1 s over
29 rebuilds since 2026-11-10 01:20Z), so this is a modest speed gain. The main
reasons to do it are less code, less disk traffic, and no shared mutable file.

## Design

Files, under `.runtime/projections/`:

- `query-entities.sqlite`: `query_meta`, `query_entities`, `query_search_document`, `query_search_fts`
- `query-metrics.sqlite`: `query_meta`, `query_metric_payloads`, `query_metric_points`, `query_metric_targets`
- `query-wearables.sqlite`: `query_meta`, `query_wearable_summary_shapes`, `query_wearable_summaries`

Table definitions are unchanged. Each file's `query_meta` holds
`schema_version`, `source_manifest` (the certificate) and, for entities,
`built_at` and `metadata_json`. `PRAGMA user_version` is 39 in every file.

Publication (still only inside `publishQueryProjectionSections`, under the
canonical write lock, after everything is read, validated and derived):

1. For each stale section, delete any leftover `<file>.tmp`, create it with
   `journal_mode = MEMORY`, `synchronous = NORMAL`, page size 8192.
2. In one transaction create the section's tables, insert rows, write the
   certificate and `schema_version`, set `user_version`. Commit (SQLite syncs
   the file), close.
3. `rename(<file>.tmp, <file>)`.

A crash before the rename leaves the previous file untouched and a `.tmp` file
that the next publication deletes. The snapshot lists only the three final
names, so a `.tmp` file is never captured.

Readers:

- `readFreshQueryProjectionSections` opens each existing section file
  read-only and reports it fresh when `user_version`, `schema_version` and the
  certificate match. A missing, unreadable or other-version file is not fresh.
- Each store function opens its own section file read-only. A missing file
  raises the existing "rebuild the projection" error.
- A reader that already has a file open keeps reading that complete
  generation after a rename (POSIX keeps the old inode until close).

Unchanged rules from the reviewed sections plan: the canonical write lock is
the publication boundary; ordinary wearable readers read unlocked only when
every section is fresh; `capture` runs under the lock for callers that need
rows of exactly the generation just published.

Deleted:

- `resetUnsupportedQueryProjection` (an old-version file is simply stale and
  is replaced by the next rename)
- `secure_delete`, `VACUUM`, every `DELETE FROM query_*`
- `applySqliteRuntimeMigrations` use for this store, `CREATE TABLE IF NOT EXISTS`
  on the publish path, `hasQueryProjectionSectionTables`,
  `assertQueryProjectionTables`
- `query.sqlite-wal` and `query.sqlite-shm` from the snapshot list
- `QUERY_DB_RELATIVE_PATH` and `queryDbPath` in `@murphai/runtime-state`,
  replaced by `QUERY_PROJECTION_SECTION_RELATIVE_PATHS`

Changed outside `packages/query`:

- `packages/runtime-state/src/hosted-bundles.ts`: snapshot list becomes the
  three section files.
- `packages/runtime-state/src/query-local-state-descriptors.ts`: three
  descriptors.
- `QueryProjectionStatus.dbPath` reports the entities file (the status fields
  are all entity facts).

## Failure modes considered

- Two sections published in one call are two renames, not one transaction. A
  crash between them leaves one fresh and one stale section; each certificate
  already answers for itself, so the next reader republishes the stale one.
- Reader opens a section file during a publication: `rename` is atomic, so
  the path always names a complete file, old or new.
- Reader checked freshness, then the file was replaced by a newer generation
  before it opened it: it reads newer rows than it checked. Same as today.
- Disk full during the build: the commit or insert throws, the `.tmp` file
  stays, the previous file is still in place.
- Power loss around the rename: no persistence is promised. A section file
  that is missing, unreadable or from another build is stale and is rebuilt.
- A later section fails after an earlier one was renamed: the earlier one stays
  published under its own certificate, the failed one keeps its previous file,
  the error propagates and `capture` does not run.
- Deploy skew: one runner version runs per container. A new runner ignores an
  old `query.sqlite` restored from a snapshot and stops capturing it. An old
  runner (rollback) does not see the new files and rebuilds `query.sqlite`.
  Local Murph no longer exists, so no machine keeps a stale file.
- Windows cannot rename over an open file. Hosted runs on Linux and tests on
  macOS and Linux.

## Verification

- Ordered content hash of all seven data tables equal to main for a full
  rebuild and for each partial publication order, on the real vault copy.
- CLI output byte-identical across the 22-command comparison set.
- Tests: crash before rename keeps the previous generation; leftover `.tmp`
  is replaced; old-version and corrupt files are stale, not errors; reader
  holding the old file across a publication; snapshot captures exactly the
  three files and no `.tmp`.
- Full `packages/query`, `packages/vault-usecases`, `packages/assistant-runtime`,
  `packages/runtime-state`, `apps/cloudflare` suites, `pnpm typecheck`.
- After deploy: `query-publication` per rebuild in production (168 ms mean
  before).

## Not doing

- Incremental (date-partitioned) rebuilds. Stored wearable rows carry
  dataset-wide indexes and a shared field dictionary, so a partial rebuild
  would need a new stored format and a locality rule every later wearable
  change must keep.
- Changing the stored row encodings.

## Architecture review outcome (ReviewGPT, 2026-11-10)

Verdict: keep the three immutable section files. Findings, all accepted:

1. `journal_mode = OFF` is silently ignored by Node 24's `node:sqlite` (defensive
   mode); the effective mode was `delete` with a `.tmp-journal` sidecar.
   Reproduced locally. The builder uses `MEMORY` (honored, no sidecar) through
   `openSqliteRuntimeDatabase` and `withImmediateTransaction`. Re-measured with
   the effective mode: 233 ms against 383 ms in the same run.
2. The production snapshot path archives every selected file into one
   tar/zstd archive on each snapshot and has no delta handling, so there is no
   per-section upload saving. The claim is deleted. Snapshot creation already
   holds the canonical write lock, so it cannot interleave with a publication.
3. The wearable admission paths called `readProjectionStatus` only for its
   `fresh` flag and paid for entity row counts. They now call
   `readFreshQueryProjectionSections` and read unlocked only when all three
   sections are fresh. Public status keeps its meaning: it exists once any
   section is published, counts and build time describe the entities section,
   `fresh` means all three. `readWearableSummaryRows` drops its explicit `BEGIN`:
   one open immutable file is one generation.
4. The power-loss wording promised more than a rename gives. Replaced by the
   stale-and-rebuild contract above.

Added validation from the review: effective journal mode and page size of the
build file and no sidecar during the build; a failed later section leaves the
earlier one published and `capture` unrun; status after metrics-first and
wearables-first publication; a reader holding the old wearables file across a
rename reads the whole old generation; an encrypted snapshot archive holds
exactly the three section files and restores them still fresh; old-name files
are ignored in both upgrade and rollback directions.

## Result

- Full rebuild on the real vault copy publishes `query-entities.sqlite` (10.02 MB),
  `query-metrics.sqlite` (13.52 MB) and `query-wearables.sqlite` (9.31 MB). The
  ordered content hash of all seven data tables and the full-text match count
  equal main.
- Publication 383 ms to 233 ms in the same run. The per-read freshness check
  stays under 1 ms (three small opens instead of one).
- One test expectation was rejected: "a current-version section file with a
  dropped table is stale". A section file gets its tables, rows, certificate and
  version in one transaction and is never modified, so no code path produces
  that file and there is no table-presence check.
- A leftover legacy `query.sqlite` is ignored and left alone; the snapshot stops
  capturing it.
Completed: 2026-11-10
