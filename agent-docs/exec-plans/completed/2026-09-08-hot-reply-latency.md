# Reduce measured hot reply admission latency

Status: completed
Created: 2026-09-08
Updated: 2026-09-08

## Goal

Reduce hot mailbox-to-provider admission toward one second by removing measured
redundant work. Use an explicitly authorized private local export only as an
ignored benchmark input; publish synthetic fixtures and aggregate timings.

## Success criteria

- Obtain an honest Docker baseline and paired candidate measurements, separating
  local CPU and injected round-trip evidence from production network latency.
- Seek as much measured deletion and reduction as practical; 500 ms is aspirational,
  not a completion threshold after the user clarified the scope. Preserve prompts,
  provider policy, accepted-input durability, access checks, fencing, and idempotency.
- Focused regression tests, relevant typechecks, privacy and complexity review.

## Scope

- In scope: existing webhook wake, mailbox import, and assistant preparation owners.
- Out of scope: live provider calls with private data, production mutations,
  deployment, changes to model prompts, new caches or scheduling owners.

## Constraints

- Prefer deletion, narrower inputs, and existing ownership over new machinery.
- A committed mailbox remains canonical accepted work. Web owns durable handoff;
  Cloudflare owns active fencing; runtime and engine own foreground admission.
- Keep original export unchanged. Pause scheduled work in private disposable
  copies and use stubbed external effects. Never commit copied private data.

## Risks and mitigations

1. Narrow directory preparation could omit a recovery or deletion destination.
   Trace canonical readers/writers and prove cold, corrupt, permission and symlink cases.
2. Removing provider reads could bypass provider-change handoff. Preserve the
   mandatory provider-entry check and test non-conversation wake behavior.
3. Local Docker does not reproduce production network geography. Report native
   and emulated execution explicitly; do not claim measured production savings.

## Tasks

1. [x] Establish current source, private input boundary, and isolated checkout.
2. [x] Run existing hot-admission benchmark or smallest production-owner Docker reproduction.
3. [x] Prove redundant preparation and serial historical-context reads.
4. [x] Implement minimal changes and compare identical baseline/candidate workloads.
5. [x] Complete focused verification, review, and scoped commit.

## Decisions

- The stored acceptance anchor is database transaction start; acceptance-to-signal
  is not a pure Temporal RPC duration. Keep the existing anchor unchanged.
- Use native public-owner Docker probes with paused automations and disabled
  networking. The existing full-stack lane is AMD64-oriented and was not run in
  this investigation; these ARM probes do not establish full hosted integration.
- Keep generic getters aligned with their read ownership, but do not attribute
  hot-path savings to getters absent from the measured service call.

## Verification

- Native Docker public service and indexed-outbox owner probes; targeted
  provider-consistency, reply-context, security and persistence regressions;
  runtime-state, assistant-engine and assistant-runtime typechecks.
- Identical semantics with fewer awaited operations, and reported timing limits.

## Investigation findings

- The production hot-container interval is not a container boot measurement.
  It combines ingress planning/handoff, mailbox retrieval and decryption,
  accepted-input persistence, context resolution, and provider preparation.
- A foreground checkpoint-interrupt wake read provider configuration before
  mailbox import and again at provider acceptance. The first read is redundant
  for actual conversation work. Keep the final live check and preserve the
  early handoff hint for non-conversation wakes. A controlled 100 ms port proves
  two serial requests become one; it does not measure production round-trip time.
- Receipt and accepted-input journal operations repeatedly prepared the entire
  14-directory assistant tree. Their existing reader/atomic-writer owners only
  need the touched parent. Private-directory validation can retain current lstat,
  type and symlink checks while omitting chmod when the mode already matches.
- A matched retained conversation reaches the 100-record indexed outbox route
  limit. Its projected-intent reader awaits each canonical JSON read serially.
  The same outbox owner already reads inventory in batches of four. Reusing
  that bounded pattern preserves the selected records and final ordering without
  adding an index, cache, scheduler, configuration, or concurrency abstraction.

## Benchmark boundaries

Baseline source: `f291b4287104235921e16e8a3c40f0848c346250`.
The installed baseline runner was frozen before edits. Candidate comparisons
replace only compiled files belonging to the edited owners.

Local Docker runs use native ARM64, Node 24.14.1, and the pinned Codex 0.153.4.
The real public assistant service talks to a deterministic loopback provider;
Docker networking is disabled, deliveries are disabled, and scheduled work is
paused in disposable copies. The original archive is unchanged. Provider bodies
are drained without logging or persistence; output accepts only allowlisted
finite numeric fields. Private inputs and probes remain ignored local artifacts.

The bounded repeats request two CPUs, a 6 GiB memory limit, no additional swap,
and 256 PIDs. These CPU/memory caps match checked-in production settings, but
not production hardware: the shared Docker VM has only about 1.91 GiB physical
memory. The direct service probe excludes Web, Temporal, mailbox transport and
decryption. Its synthetic new session also excludes the existing route's history
lookup, which is measured separately through the real outbox owner.

### Direct service: directory/receipt/journal changes only

Two warmups and five measured turns per process; baseline/candidate and reversed
order, ten measured turns per version in each comparison. No live model calls.

| Pooled median | Baseline | Candidate |
| --- | ---: | ---: |
| Earlier run, no explicit container quota, service to provider | 239.98 ms | 186.38 ms |
| Explicitly bounded repeat, service to provider | 231.09 ms | 269.22 ms |
| Bounded repeat, pre-provider setup | 136.5 ms | 122 ms |
| Filesystem calls before provider, consistent in both repeats | 1437 | 551 |

Elapsed-time direction is inconsistent. These results prove removal of 886
filesystem calls per turn, not a reliable millisecond speedup. The direct service
probe does not exercise the hosted provider-configuration change or the matched
historical route. Do not sum overlapping spans or extrapolate these measurements
to a production 500 ms improvement.

### Existing route history

Initial read-only profiling selects the existing route in memory and uses the
canonical intent parser. It loads 100 records, approximately 279 kB total.
The public `assistant-outbox` route API ran alternately at baseline and the first
four-file candidate in one Node process, with four warmup pairs and 16 measured
pairs. All 40 calls returned deeply equal record arrays in the same order.

| Full owner, first four-file candidate | Baseline | Candidate |
| --- | ---: | ---: |
| Median lookup | 120.55 ms | 58.90 ms |
| Canonical file reads | 100 | 100 |
| Maximum concurrent canonical reads | 1 | 4 |

Median paired savings were 63.40 ms; all 16 pairs improved (20.23–100.65 ms).
There were no record writes or renames. A later incremental comparison of only
the two-directory outbox prelude removed another 12 mkdir and 50 lstat calls.
Its median paired difference was 14.15 ms, with only 11/16 positive pairs and
substantial noise, so do not assign that cleanup a reliable time saving.

The snapshot's unanchored route state is blocked. The final context planner now
checks that state first and never requests its unused history. Missing/corrupt
migration tests prove this through the composed reply planner; explicit native
anchors and ready routes retain history. Current production prevalence of the
blocked state was not measured.

## Preserved contracts and deferred scope

- Canonical receipt/journal records and outbox files remain unchanged. Existing
  runtime write locks, missing/corrupt-record recovery, security checks, and final
  provider authority remain the owners. No prompt, model, or tool changes.
- Keep wake transport, live access/consent checks, Temporal durability, ingress
  crypto separation, and checkpoint fencing. Their serial latency cannot be
  removed merely by describing the container as hot.
- No new public benchmark harness or private fixture is committed. The existing
  full-stack hot-admission lane remains the integration owner; the local ARM
  probes establish narrower boundaries and do not replace that lane.
- No member changelog entry: this candidate removes internal admission work;
  a delivered-response or production latency improvement has not been observed.
- No deployment or production mutation is part of this local task. Production
  effectiveness still needs a deployed-version comparison of matching hot traces.

## Further measured deletions

A counts-only probe of the intermediate four-file candidate attributed four
full-tree preparations on each direct hot turn to session resolution, private
completion reconciliation, private-completion route lookup, and transcript
append. Together those calls caused 56 mkdir and 232 lstat operations. These
owners now prepare their exact required directories:

- Session resolution: sessions, routing state, and session-secret deletion ancestry.
- Private completion: sessions initially; transcript and secret ancestry only
  when importing a completion. Its existing outbox query owns outbox/state setup.
- Outbox read/list/find: outbox and SQLite state; cold rebuild and quarantine stay
  with their existing owners.
- Transcript read/tail/append: transcripts; empty append skips directory setup.
- Cross-session route read/claim: exact route and receipt directories.
- The filesystem permission owner itself skips repeated parent mkdir on warm
  paths. Current lstat still proves ancestry exists and rejects symlinks; missing
  private-root construction retains the previous outside-parent mode behavior.

No new production helper, cache, dependency, schema, configuration, or scheduler
was introduced. Directory fanout is explicit at each existing reader. The shared
permission function, canonical atomic writers, runtime locks, and recovery paths
remain the security and durability owners.

## Final combined service comparison

The final probe loads the real public assistant service from two isolated module
graphs in the same Docker process. Each variant uses an identical disposable
canonical vault copy, its own native Codex home/app-server, and the same loopback
provider stub. Four warmup pairs precede 16 measured alternating-order pairs.
All 40 provider requests were expected; stable response, status, media and delivery
fields were deeply equal across every pair. Variant-specific session IDs and vault
locations are deliberately excluded from that comparison.

The final frozen overlay contains eight compiled engine/state owner files. The
hosted-runtime provider-read change has separate runtime regression proof and is
not exercised by this service probe. The real route-history owner is measured
separately above; a synthetic new conversation does not have its 100-record history.

| Final direct service median | Baseline | Final candidate |
| --- | ---: | ---: |
| Service to provider callback | 176.90 ms | 131.14 ms |
| Service to actual loopback provider POST | 290.13 ms | 221.14 ms |
| Pre-provider setup | 98.5 ms | 63.5 ms |
| mkdir calls before provider | 155 | 8 |
| lstat calls before provider | 661 | 230 |
| chmod calls before provider | 621 | 18 |
| Total counted filesystem calls | 1437 | 256 |

The service-to-provider median paired saving is 60.25 ms: 14/16 pairs improved,
with a range from -14.79 to 281.52 ms. The actual POST median paired saving is
50.73 ms. Differences of medians and medians of paired differences are distinct
statistics. All measured turns remove exactly 1181 filesystem calls (82.2%).
This supports a local engine improvement around 50–60 ms under these conditions,
not a production 500 ms or one-second admission guarantee. Do not add the separate
owner timings as though they were one measured end-to-end production improvement.

Earlier three-/four-file results remain labeled separately. The safe evidence
and strict-output reproduction scripts are ignored local artifacts:
`.tmp/hot-reply-private/BENCHMARK_EVIDENCE.md`,
`.tmp/hot-reply-private/run-direct-service-final-paired.py`, and
`.tmp/hot-reply-private/run-projected-outbox-owner-paired.py`. No private fixture,
provider request, or local bundle is included in the commit. The final service
probe reports warm native reuse and zero spawn-ready events in all 32 measured
turns. All eight source/overlay hashes matched at handoff; numeric-output and
privacy validators passed.

Outcome: the local investigation and scoped optimization are complete. The
aspirational production latency target is unproven; observation after a separately
authorized deployment is the remaining effectiveness boundary.

## Final validation

- Runtime state: 8 security/atomic-writer tests, including warm no-op behavior,
  cold/missing-path recovery, later permission repair, and symlink refusal.
- Receipts/journals: 28 focused tests, including missing parents, redaction,
  accepted-input persistence and symlink safety.
- Hosted runtime: 98 tests across provider consistency, causal inputs, scheduling
  and checkpoint wakes. One live provider read remains on foreground admission;
  changed/unavailable provider cases preserve pending work.
- Reply context: 116 event-path tests, including ready/native/group behavior,
  blocked/corrupt migration without history loading, and history-error retry.
- Outbox: 15 focused canonical lookup/recovery tests, including bounded I/O,
  ordering, exact native anchors, corruption, legacy dedupe, and writer races.
- Private completion and route state: 56 tests across both complete suites,
  including applied/prepared replay and secret/transcript/route/receipt symlinks.
- Session resolution: 15 resolution-store tests and 8 preflight tests. The opt-in
  cardinality suite was not run; the bounded route/old-anchor tests above passed.
- Transcript persistence: 5 focused tests including entry references, retention,
  exact directory setup and public read/append symlink refusal.
- Relevant typechecks pass. `pnpm complexity:diff` passes for all nine modified
  source files: aggregate debt falls by two; the changed context function falls
  from 27 to 26. Existing unrelated large hotspots remain unchanged.
- `pnpm docs:drift` and `git diff --check` pass. Parent and independent reviews
  found no unresolved correctness/security issue. Raw private data is ignored
  and excluded from the scoped commit.

Review and release boundaries: this is a local code/benchmark task, with no PR,
remote CI, final external ReviewGPT, merge or deployment performed. The repository
requires its PR review and exact-head CI gates before a later landing. No state
schema or external API changes are introduced; existing old/new readers consume
identical records. A future deployment must measure fresh matching hot traces to
establish production latency effectiveness.
Completed: 2026-09-08
