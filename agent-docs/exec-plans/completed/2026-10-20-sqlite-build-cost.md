# Reduce measured query SQLite rebuild cost

Status: completed
Created: 2026-10-20
Updated: 2026-10-20

## Goal and invariant

Reduce cold query SQLite rebuild work at its existing owner without changing
canonical facts, metric identities, selection/provenance, ordering, freshness,
atomic publication or failure recovery. No new cache or background machinery.

## Evidence and scope

Issue #3997 records a historical 23.4-second metric projection span inside a
54.3-second rebuild. Synthetic ranking and long-history improvements alone did
not establish its cause. The user now authorizes direct implementation and
local profiling of a supplied example vault. Private contents stay in a
restricted temporary local copy, never repository fixtures or review context.
Only aggregate operation measurements leave that copy.

## Current owners

`packages/query` owns canonical source reading, wearable/metric derivation and
publication to the rebuildable query SQLite database. The existing canonical
writer lock encloses capture through publication. Existing timing spans identify
stages. Any accepted correction will stay at the demonstrated expensive owner.
Canonical state and persisted format remain unchanged unless evidence requires
an explicit schema migration; no such migration is currently planned.

## Tasks and proof

1. Refresh default branch and coordination; profile the actual local rebuild.
2. Follow the dominant stage inward and reproduce the causal mechanism with
   independent synthetic data. Establish complete output equality assertions.
3. Apply the smallest correction; compare paired warm runs with the same inputs,
   including actual SQLite build/read results and failure cases as applicable.
4. Run focused tests, typecheck, complexity and required assistant journey if
   assistant-visible behavior changes. Review the full diff and privacy boundary.
5. Commit and open a scoped draft PR; final ReviewGPT and exact-head CI precede
   authorized merge/deployment. Preserve release/observation blockers honestly.
6. Remove the task-created private temporary copy after local comparisons.

## Risks and decisions

- Historical archive compatibility is checked through the current strict reader;
  do not silently drop records to manufacture a faster build.
- Local timings do not establish an exact production speedup. Separate CPU work,
  I/O, allocation/GC and SQLite publication before choosing a correction.
- Preserve the original archive. Share only synthetic proof with reviewers.
- Existing tool/browser failures do not waive final ReviewGPT or release gates.

## Verification

Selected cause: Apple zero-sleep repair associated every awake/zero-stage
candidate with every Apple sleep window whenever any zero total existed. A
window without an owned zero total cannot be repaired. Check that necessary
condition first, with ownership before timestamp association; qualify Apple
providers once and retain the no-zero fast path. Original repair selection,
awake ordering, legacy companions and suppression evidence remain unchanged.

The synthetic 180-day sparse-zero regression performs 32,942 associations on
base and fails the bounded-work assertion. The candidate passes the same
assertions while preserving all unrelated awake records and windows. A second
regression proves other-provider zeros cannot activate Apple repair; it also
fails on base. Existing repair, provider and projection regressions pass.

On the user-authorized local example, complete wearable datasets compare equal.
Date.parse calls fall from 1,460,528 to 1,183,100 (277,428 fewer, 19.0%).
Five alternating warm pairs initially measured dataset wall medians of
1,071.42 to 937.92 ms (ranges 1,024.41–1,102.41 and 884.94–952.36 ms).
After the final fast-path/ownership refinement, five more paired runs measured
process CPU medians of 1,259.25 to 1,092.16 ms (ranges 1,185.08–1,366.92 and
1,072.19–1,162.17 ms); wall medians were 1,357.18 to 1,291.68 ms with substantial
scheduler variation. Do not interpret these as a precise production speedup.

Five alternating cold SQLite rebuild pairs preserve every stored row and FTS
index (excluding build timestamps), pass integrity_check, and produce equal
33,685,504-byte databases. Whole-build wall medians are 5,675.73 to 5,799.42 ms;
ranges 4,803.42–5,863.09 and 5,266.04–9,039.57 ms. The dataset-stage median falls
from 1,136.98 to 950.06 ms, while unchanged publication/metric stages vary.
This does not establish an end-to-end wall-clock improvement.

Focused checks: 22 sleep/candidate tests, 49 metric/browser/provider/normalized
projection tests, query typecheck and complexity guard pass. Final refinement
also passes all 12 sleep-session tests and typecheck. No assistant contract,
provider input, reply selection or persisted shape changes; deterministic full
output parity covers the optimization boundary without a new live-model journey.

A separately tested provider-label allocation change was rejected: complete
outputs matched but paired timing did not establish a worthwhile effect.
Historical PR #3535 narrowed repair candidates; this correction independently
bounds the remaining sparse-zero, many-window scan after that change.

## Remaining investigation and release

This dataset optimization does not explain the historical 23.4-second metric
projection span in issue #3997. The deployed nested metric telemetry from
PR #4217 remains the next experiment: observe normal traffic for a slow metric
span, attribute evidence/extraction/precedence/target work, then reproduce that
stage with synthetic cardinality and scheduling pressure. No claim of resolving
that severe event or exact production speedup is justified by this local sample.

PR #4251 contains the scoped candidate. Changelog generation, all 10 archive
render tests and Web typecheck pass. The task-created restricted private copy
and generated databases were deleted; the original archive is untouched.
Final ReviewGPT passed on f0e8b500bcd28e4d49edb96b0406dd27972ffe30 after more
than five minutes on the Eragon GPT-6 Pro lane, with exact attached snapshot,
head/hash validation, substantive response and REVIEW_COMPLETE. Parent accepts
PASS with no findings. The reviewer independently executed 2,030 base/head
sanitizer comparisons, including sparse/dense zero histories and provider/legacy
boundaries; sparse associations fell from 32,942 to 183. It did not execute the
full SQLite suite; parent integration proof above covers that boundary. The
first 126-second response was rejected by the repository minimum and is not
counted as approval. Parent final diff and privacy review pass.

Required final-head CI, protected deployment and four-hour observation remain
pending; this closes the implementation plan, not the production investigation.
The missing CPU-versus-wall attribution is now implemented independently in
PR #4254 under the telemetry prerequisite and remains subject to its own gates. No temporary app heartbeat capability is currently exposed;
that prevents claiming scheduled observation until a heartbeat can be verified.
Completed: 2026-10-20
