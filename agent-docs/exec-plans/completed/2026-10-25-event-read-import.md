# Canonical event-read import experiment

Status: completed

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

Parent's final rebuilt native CLI after instrumentation used Node 24.22.1,
darwin arm64, the same synthetic 24,003-row / 24-shard mixed-format fixture,
two warmup pairs and ten alternating cold-process pairs per comparison.
Loaded work fell from 380 modules / 5,827,629 bytes to 302 / 4,577,010;
CLI bundle bytes grew from 9,663,371 to 9,666,876 (+3,505), with no displaced
preload. Endpoint-free paired median wall/CPU deltas were -35.008/-45.484 ms;
with telemetry enabled on both artifacts they were -34.889/-42.028 ms.
Same-candidate disabled/enabled telemetry had paired median wall/CPU overhead
of +5.106/+5.306 ms. That includes existing transport and coarse timing as well
as the new spans. Full ranges, paired ratios, initial base/base control and
measurement boundaries are in `packages/core/bench/README.md`; these local
results do not establish hosted latency or the owner-scan tail's cause.

The rebuilt assemblies passed complete stdout/stderr/status parity,
adversarial cases, canonical-input hashes, cleanup, eight parity probes and
bundle budgets. Telemetry `check`, both-on `pairs` and same-candidate off/on
`control` passed every receipt gate, all twelve candidate phases, zero dropped
spans and complete output/canonical parity. Socket setup and the bounded
post-close receipt wait stay outside child measurement; actual sender and
instrumentation work remain inside. Parent reran all eight driver tests.

Earlier parent checks passed 27 core surface/owner/storage, 75 runtime-state
timing/process/CPU, 21 assistant-engine profile/transport and 6 Cloudflare
usage-port tests. The 20 runtime-state and 9 assistant-engine historical
compatibility skips were unrelated; the new mixed-version checks ran against
the pinned base below. Runtime-state, core and assistant-engine typechecks
passed. Additional parent checks passed 40 compressed-ledger/interruptible-reader
tests, 46 Web changelog tests, Web typecheck, workspace boundaries, privacy diff
scan and diff check. Rechecked complexity: ten changed source files, zero
hotspots; benchmark `main` maximum 20. These are supplied parent results.

The current-candidate manual-photo real-model journey passed in 40.2 seconds
with `gpt-6.1-sol` and local subscription auth; parent reply review was Ready.
It saved one meal, acknowledged the photo and asked for essential food/portion
information without invented nutrition, a card or another save. Its `tsx`
source CLI proves that focused live behavior; the deterministic assembled-native
benchmark independently proves production import resolution and byte parity.

The added canonical-launcher exact-read attempt exited 64 before any provider
request because available Codex binaries lack `--ignore-user-config`; no usable
built binary was found in the known sibling targets. The new exact-read test
now reuses the existing ordinary-provider fixture and built CLI subprocess
helper. It retains actual successful `meal show`, saved-fact reply and zero-write
assertions without changing the canonical launcher, permission profiles, auth
handling or production config. Parent passed the adapted journey on Node 24.22.1,
`gpt-6.1-sol` and local subscription auth in 17.184 seconds: exactly one provider
request and one successful actual `meal show`, correct saved food/calories/protein,
unchanged canonical snapshot/write metadata, and no outbox/card/media/runtime
issues. Parent reviewed the actual reply as Ready. This proves the local provider
plus built CLI, not the canonical hosted permission profile. The focused command
is in the bench README.

Changelog: updated, `2026-10-25 · meal-lookup-startup`, source PR #4364.
The entry describes quicker saved-meal lookup with unchanged facts; it makes
no quantified hosted speedup claim. Publication remains with the parent.

The guarded source snapshot omits unchanged frozen-install patch dependencies,
including Incur. Parent logged the report verbatim at
`.agents/friction-log/20261025213049-full-audit-snapshots/friction.md` and passed
privacy readback; packaging is outside this PR. This author has not run assembled
benchmarks, providers, Vitest, package builds or typechecks. Earlier author
checks covered the eight Node driver tests (including the actual production
sender over loopback), script/TypeScript syntax, workspace boundaries, the
changelog loader and standalone timing/mixed-version owner checks. Parent
results above supply the broader execution evidence.

Required final ReviewGPT, exact-head CI, merge, consumer-first deployment and
observation remain in PR #4364. There has been no production deployment.
Heartbeat scheduling is a concrete completion blocker because no scheduler is
currently exposed; no follow-up is scheduled and the 72-hour observation window
has not begun.
Parent will close the plan/index mechanically with `finish-task` once gates
are recorded, retaining review, deployment and observation records in PR #4364.

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

Parent verified the documented bounded observation SQL with `EXPLAIN` against
the current control-plane schema; no row data was returned. Live observation
remains pending.

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
Updated: 2026-10-25
Completed: 2026-10-25
