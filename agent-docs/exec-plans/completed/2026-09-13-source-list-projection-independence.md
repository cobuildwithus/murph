# Source-list wearable projection reuse

Status: completed
exact-head CI remain PR completion gates; neither is claimed passed here.
Base: `5b4f8ac08d11afb546bd224f276fe85db02f10fe`.
Committed runtime implementation: `1330259345aa0c4cefad4c1a4a086f7a79402f35`.
The final incremental correction is benchmark-reporting and documentation only.

## Outcome

Preserve exact public source coverage, freshness and diagnostic semantics while
avoiding unrelated global work and repeated provider derivation. The completed
public-usecase benchmark shows improved primary cold and 15-source cumulative
medians and improved matched repeated-query cohorts. Source -> global combined
is roughly flat, not a reliable speedup. One global repeat-position increase is
retained with its independent diagnostic disposition; not every timing improved.

## Final design

Use the existing query SQLite owner and `query_wearable_summaries` table. The
complete canonical source manifest lives in the existing
`query_meta.wearable_source_manifest` entry, independently certifying wearable
rows. No new table family, cache/database/service, background work, dependency,
ledger or canonical truth is introduced.

Source reads hold core's existing reentrant cross-process lock through manifest
capture, strict canonical reading when stale, provider derivation/encoding,
transactional row-plus-manifest publication and stored-row capture. Repeated
reads use the stored rows and existing codecs/composition. The sourceHealthOnly
optimization avoids discarded preliminary health work while preserving ordinary
stored-path parity.

Partial publication does not touch or certify global metrics/entities/search.
Global freshness needs its own completed build and matching full manifest as
well as current wearable rows; an empty manifest cannot certify an unfinished
global projection. A full rebuild reuses a current wearable portion. Version 28
uses the existing reset seam; builtAt is not generation identity. A new partial
store omits global tables so an older in-flight global reader fails its existing
table guard after a reset. Full schema promotion and publication share one
transaction; failures roll back global DDL, rows and metadata. Strict errors,
canonical commit/rollback visibility and lock ownership remain unchanged.

## Parent validation evidence

The proof covers missing/stale/fresh/empty/legacy/future/unreadable stores,
missing/corrupt metadata, corrupt activity evidence, provider/date/limit filters,
corrections/deletions, exact stored output, no unrelated global work, reuse
counts, lock-held publication, concurrent/reentrant readers, canonical
commit/rollback, encoding/transaction failures and both read orders across writes.

The initial eight-file focused query run passed 73/74. Its only failure was a
new fixture assumption that hidden numeric metric observations create ordinary
visible entity rows, not a production projection failure. A separate attested
test-only correction added a visible manual note under the canonical write lock,
captured the initial complete entity result, and required that exact oracle to
be restored. The final full source-health test file passed **18/18**.

The parent reports **196 query tests covered across focused runs**, including
reported broader-query coverage of **122 passing tests**. Public-usecase tests
passed **6/6**, web changelog tests **17/17**, and PR changelog-validator tests
**14/14**. Query/usecase/benchmark semantic typechecks and public package builds
passed. These run counts are not summed into an additional unique-test claim.
Actual version-27/version-28 public-reader compatibility, both read directions
and canonical writes matched complete source and metric outputs.

The complexity guard passed: composition debt **1 -> 0**, maximum **21 -> 19**;
schema maximum **10 -> 7**; freshness **7 -> 12**. Only the unchanged existing
`summarizeWearableMetricFromBundle` score of **39** remains.

## Completed measurements and reporting correction

The full benchmark completed **27 scenario pairs**, with two warmup and seven
alternating measured pairs per source-only/source-global/global-source scenario.
All complete response hash/byte/cardinality and projection assertions passed;
all source-repeat position medians improved. Parent-measured medians in ms:

| Workflow | Before | After | Paired wins |
| --- | ---: | ---: | ---: |
| Primary cold | 2,783.767 | 1,914.646 | 7/7 |
| Primary 15-source cumulative | 13,375.033 | 10,142.504 | 7/7 |
| Source sequence plus next global | 13,938.005 | 11,651.207 | Not supplied |
| Source -> global combined | 12,027.313 | 11,924.602 | 3/7 |
| Global -> source combined | 11,955.430 | 11,325.334 | 7/7 |

The original timing exit **1** was solely global-source's
`after-source-write-repeat-global`: **497.423 -> 516.385 ms, 2/7 wins**. Keep this
point result visible. In the same run, its complete global repeat cohort improved
**1,540.189 -> 1,432.304 ms, 4/7 wins, -57.028 ms median paired delta**. All five
nonempty scenario/operation repeat cohorts improved; their full values are in
`packages/vault-usecases/bench/wearable-sources.md`.

An independent parent diagnosis also completed: the same public global-source
workload followed by eight additional source -> global repeat pairs per worker,
with two warmup/seven alternating measured pairs and complete response-hash
equality. Repeated totals improved: combined **8,015.184 -> 7,081.654 ms (7/7)**,
source **4,119.867 -> 3,328.025 ms (7/7)**, global
**3,918.216 -> 3,785.038 ms (5/7)**. The isolated approximately 19 ms increase did
not persist as a sustained broader-query slowdown in this diagnostic. This
disposition is not a claim that every position improved.

The justified reporting correction retains every position, paired win, raw
sample, output comparison and projection assertion. Source repeat-position
medians must still be non-increasing. Every nonempty repeated cohort groups one
scenario and operation, sums all repeat/fresh-index positions within each worker,
then requires a non-increasing median and a non-positive median paired delta.
Global-position increases remain explicit investigation flags, not automatic
failures of this sustained-regression gate. Cold, all cumulative-median and
source-sequence-plus-global checks remain intact. Source -> global stays roughly
flat; synthetic timing does not establish production tail/end-to-end performance.

The small saved-JSONL replay path shares live validation and summary logic,
requires all 27 unique fixed scenario/pair slots and full semantics/invariants,
rejects malformed/unknown/missing/duplicate/mismatched evidence, and disregards
only a recognized terminal summary's old verdict. Runtime, fixture, canonical
writes, public usecases, query counts, worker sequence and warmup/pair counts are
unchanged. Replay is invalid after runtime or workload changes.

## Product and operational scope

Public schemas, provider/date/limit behavior, ordering, provenance and staleness
semantics remain unchanged. There are no prompt, tool-schema, routing or initial
provider-input changes; identical-output internal performance work did not need
a new real-Codex journey. Member-facing changelog copy retains the same coverage,
freshness, duplicate/conflict and correction/deletion promises and is associated
with PR #3432. No new Frog entry was created: existing attachment-recovery issue
#2588 was used, with private recovery evidence retained outside tracked files.

## Scoped completion

Implementation is complete. The parent will verify the reporting correction by
checking the unchanged worker, benchmark semantic typecheck, real saved-run
replay and missing/duplicate/mismatched/doubled-repeat-latency negative controls.
No runtime execution result is inferred from authoring or replay code alone.

The parent owns the existing finish-task script, mechanical archival of this
active plan, Git/PR actions and the intended final-candidate commit. This patch
keeps the authored plan at its active path. Its index link anticipates
`agent-docs/exec-plans/completed/2026-09-13-source-list-projection-independence.md`
in that same atomic scoped completion commit; no historical completed plan is
edited. **Final ReviewGPT and exact-head CI must still pass for PR completion.**
Updated: 2026-09-14
Completed: 2026-09-14
