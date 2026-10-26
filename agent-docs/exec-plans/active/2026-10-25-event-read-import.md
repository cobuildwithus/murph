# Canonical event-read import experiment

Status: draft PR #4364; import mechanism accepted and focused parent checks
passed. Enabled-telemetry measurement, final gates and release remain pending.

## Outcome and protected boundary

Reduce cold `meal show` import work while preserving canonical reads, all scans,
authorization/path checks, visibility, ownership, revisions, errors and output.
The import change only switches the exact-event loader's public core specifier.
Core owns the existing readers; no cache, algorithm change, ledger split, new
dependency, preload, registry or additional fallback is justified.

## Plan and decisions

1. Trace the erased runtime dependency closure and production resolver. The
   ledger does not loop back to core's root. Production's variable import uses
   the installed export map; assembly already preserves exports and emitted
   entries. Root tsconfig wildcard and manifest-derived test aliases suffice;
   Web's separate map receives the explicit entry.
2. Expose `core/event-read` as the same two function objects and change only the
   two exact-event runtime specifiers. Reuse the existing owner/error/timing
   regressions and synthetic full-ledger fixture.
3. Run the actual assembled CLI regression, base/base control and alternating
   cold base/candidate pairs described in `packages/core/bench/README.md`.
   Compare complete results, input/output bytes, loaded native/chunk work,
   CPU/wall variation and canonical-input preservation.
4. Reject the runtime/export candidate if the import work remains or the
   independent measurements do not show material benefit beyond variation.
   Keep diagnostic proof only in that case. Parent owns applying, running,
   reviewing, committing and releasing.
5. Add bounded operation timing to this meal-owner read only, through the
   existing timing pipeline; use natural traffic to distinguish source/path/read
   awaits from synchronous decode/parse/selection before proposing a scan change.
6. Measure the assembled CLI with telemetry enabled identically on both sides,
   then compare one candidate with telemetry disabled/enabled. Require receipt,
   fixed-phase, zero-drop and complete output-parity proof for measured children.

## Accepted import evidence and remaining gates

Parent's native assembled-CLI measurement on Node 24.22.1, darwin arm64 used
the same synthetic 24,003-row, 24-shard mixed-format fixture, two warmup pairs
and ten alternating cold-process pairs with load hooks disabled during timing.
Loaded work fell from 380 modules / 5,827,629 bytes to 301 / 4,571,152;
the assembled CLI grew by 22 bytes with no preload relocation. The paired
median wall delta was -32.410 ms and CPU delta -40.174 ms, compared with
base/base control medians of -2.006 ms and -1.846 ms. Full ranges, ratios and
measurement limits are in `packages/core/bench/README.md`.

The initial assemblies passed complete stdout/stderr/status parity, adversarial
cases, canonical-input/cleanup checks, eight parity probes and bundle budgets.
For the instrumentation follow-up, parent reports 27 core surface/owner/storage,
75 runtime-state timing/process/CPU, 21 assistant-engine profile/transport and
6 Cloudflare usage-port tests passing. Runtime-state and assistant-engine had
20 and 9 unrelated historical compatibility skips respectively; the new
mixed-version checks were enabled against the pinned base below. Runtime-state,
core and assistant-engine typechecks pass. Complexity: ten source files, zero
hotspots. These are supplied parent results, not this author's executions.

Final assembled checks/pairs, enabled-telemetry overhead measurements,
additional CLI/Web gates and the real-model exact-read journey remain pending.
The earlier cold-process measurement omitted the telemetry endpoint. The
optional `MURPH_EVENT_READ_TELEMETRY=on` mode enables both artifacts; `compare`
uses `control` on one candidate for disabled/enabled pairs. Receipt validation
requires the fixed candidate phases and zero drops without exposing endpoint
or key. Socket setup and the bounded post-close receipt wait are outside the
reported timings; child sender/instrumentation work remains inside. These
modes close the harness gap but have no measured result yet.
The manual-photo journey uses a source `tsx` CLI; the focused journey uses the
built native CLI and requires the saved read, truthful reply and zero canonical
mutation. Commands and measurement boundaries are in the bench README.

Changelog: updated, `2026-10-25 · meal-lookup-startup`, source PR #4364.
The entry describes quicker saved-meal lookup with unchanged facts; it makes
no quantified hosted speedup claim. Publication remains with the parent.

The source snapshot's frozen install is blocked by omitted dependency patch
files, including the pinned Incur patch. The results above were supplied by
the parent; this author has not run the assembled runtime, Vitest, package
builds or typechecks. Dependency-free driver tests, syntax parsing and
workspace boundary verification were the available initial author checks.
Follow-up author checks passed the three driver tests, workspace boundaries,
TypeScript syntax parsing and the production changelog-fragment loader. Actual
old/new timing and hosted usage readers from the supplied source passed a
standalone mixed-version check for all twelve new names and profile v1/v2;
the production timing owner/private scan helper passed aggregate, cap,
error-identity, concurrent-scope, closed-callback and disabled-clock checks.
The parent checks above now cover the focused Vitest, exact-history and three
package typecheck gates. They do not establish final native-assembly performance,
enabled-telemetry overhead, the real-model journey or production attribution.

This telemetry-mode follow-up passed all eight focused Node driver tests,
including the actual production sender over loopback UDP, receipt rejection,
privacy projection and disabled/enabled output parity. Script syntax, workspace
boundaries and the production changelog-fragment loader also passed. This is
harness validation; assembled telemetry-overhead measurement remains pending.

## Remaining owner-scan question

The import improvement does not resolve the owner-scan tail. Across 73
successful reads, candidate discovery totals 95,510 ms and revision selection
88,307 ms; maxima are 7,892 ms and 7,643 ms and cannot be paired. These are
awaited wall times, not CPU attribution. A separate synthetic 240,003-row,
126 MB run returned the same result with 24 shards (median 833 ms, range
828–843) and 120 shards (median 880 ms, range 878–955). Those observations do
not justify changing the scan algorithm.

Parent's later network-isolated Linux amd64 emulation reproduced slower scans
on the same 240,003-row mixed-format shape: ten warm pairs had owner wall
median 10,410.756 ms (10,188.039–10,673.209) and CPU median 12,517.598 ms.
The requested 2 CPU / 6 GiB was constrained by a Docker VM with 1.9 GiB;
the known-event control (5,382.796 ms) is not contract-equivalent. A separate
whole-run profile includes fixture setup and shows substantial JSON parsing,
GC and decompression; its sample totals and limits are in the bench README.
CPU/parse is a realistic hypothesis, not an established production cause.
Keep the current instrumentation and do not rewrite the scanner speculatively.

The runtime database has no container CPU profile, and the current opaque
Cloudflare auth reports no active authentication for reading existing profiles.
Do not substitute secrets or new infrastructure. Resolve the missing internal
timing on this same read path before proposing another optimization.

## Bounded scan observation and rollout

The additive phases are `event-owner-{candidates,revisions}-{source,path,read,decode,parse,select}`.
Each reached scan contributes six aggregate durations, including zero for
unreached categories, regardless of shard count. Existing parent samples stay
unchanged; the 64-span cap stays in force. Emit no paths, identifiers, content, row/shard counts or CPU estimate.
These remain wall durations: awaits include scheduling, and synchronous spans
are not process-exclusive CPU profiles. Timing does not alter scan order,
validation, cancellation, error identity, canonical bytes or output.

Parent passed old-producer/new-consumer and new-producer/old-consumer checks
using `MURPH_CLI_EVENT_OWNER_WORK_COMPAT_BASE=7bcd0ffe430c8cba53da74dbb6d5c10a3560bdd8`
as the pinned baseline. A new consumer accepts old timings; an old
consumer drops the entire unfamiliar optional `cliTiming` while retaining its
usage/profile envelope. Verify the compatible Web consumer first, then Worker,
then deploy the runner producer/receiver. Rolling a reader back below that
compatibility floor loses timing from new runners; runner rollback is safe.

Begin a 72-hour natural-traffic window only after verified deployment, with
the first four hours reserved for health checks. Check timing coverage,
trimming/dropped samples, read errors and output/canonical-state regressions;
do not generate member traffic. Compare phase totals within the same retained
command/outcome cohort with matching sample counts; keep old and new producer
versions separate. Report
aggregate distributions and missing samples, never production rows or paths.
If source/path/read dominates, repeat the existing synthetic shape under the
same allocation and investigate the awaited storage boundary. If synchronous
decode/parse/select dominates, profile that synthetic workload before proposing
an owner-preserving change. With inadequate natural samples, report the gap;
do not claim the scan tail is resolved or change its algorithm speculatively.

The deduplicated source-cause, cron recovery and Personal Patterns work remain
outside this patch. No failed-work recovery or post-photo-removal read is changed.
