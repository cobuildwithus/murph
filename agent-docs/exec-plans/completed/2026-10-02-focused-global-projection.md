# Focused projection reads and reusable wearable derivation

Status: completed
Created: 2026-10-02
Updated: 2026-10-05
Base: `938664ca9337bf72b4b83aa08f54dfdc0803f928`
Evidence: [PR4018](https://github.com/cobuildwithus/murph/pull/4018) at `eeac8b2651bfb5707c944958b18cb96725db8aef`

## Goal and evidence

Avoid unnecessary full projection work for eight ordinary wearable readers and
blood-test lists, reuse equivalent Browser Vault derivations, and reduce repeated
expected-empty verification serialization during necessary full rebuilds without
changing facts, stored/public bytes or freshness semantics. The parent has
completed the native, product and synthetic paired proof described below. These
measurements support the targeted work reductions; whole edited-global workflow
wall improvement remains **inconclusive**.

The metadata-only September 29–October 2 UTC aggregate contains 11 successful
blood-list calls totaling 46.894 seconds, including five rebuilds totaling 39.320
seconds (maximum 14.499). Latest/activity/recovery also triggered unnecessary
global work. This aggregate identifies costs, not candidate speedups; no private
production payload was inspected or published. Timestamp-only invalidation was
demonstrated synthetically, not its production frequency.

## Scope, owners and decisions

- Query's ordinary helper preserves the old unlocked stored-bundle read only when
  the existing full global status predicate is fresh. Otherwise it delegates to
  the existing locked focused owner and unchanged normal composer/summarizers.
  Sleep and source-health keep their existing focused owners and composition;
  neither inherits the ordinary fast path.
- Keep strict current validation, reentrant focused capture and atomic wearable
  publication. Focused reads do not certify unfinished global work, publish
  global rows or compact. Required full reads still synchronously rebuild in the
  existing CLI process. Source-only reads still validate strictly and capture
  under the existing lock.
- Preserve the global predicate's schema, built-at, both manifests and SQLite
  dictionary/row transaction checks, its old check/read window, and direct
  stored-read/reset errors. A writer starting after observation can still leave
  a reader using the prior projection. A wearable-only certificate, including one
  published inside an outer writer, is not a new nonblocking-read contract.
- Every ordinary wearable read pays the explicit global manifest/status preflight.
  The fallback also pays the existing locked wearable recheck and capture, including
  when wearable-only rows are current. These are separate charged freshness
  spans; none is hidden or credited as removed.
- Reuse finite module-private expected JSON strings, not facts or decoded objects.
  Keep actual-envelope byte comparison, fallback and fresh decode allocation.
- Leave Sleep Patterns' timezone/metadata ownership unchanged. No dependency,
  telemetry, background/cache owner, restoration change, persisted schema or CLI
  orchestration is introduced; the existing process/lock boundary remains
  authoritative.
- Parent owns Git/PR, independent inspection, builds, measurement, local
  subscription Codex proof and acceptance. The author supplies tracked patch
  changes. Exact Opus 5.5 investigative advice changed neither implementation
  ownership nor the Murph runtime model.

## Tasks and acceptance

1. [x] Route eight readers through focused freshness when global state is not
   already fresh, preserving the baseline unlocked global path and sleep owner.
2. [x] Remove repeated empty expected serialization without decoder caching.
3. [x] Cover eight-reader query/service matrices, independent full-row oracles,
   cold/fresh/partial/stale/correction/deletion, strict errors, provider/date/limit,
   reentrant capture, rollback and explicit global promotion after focused reads.
4. [x] Cover exact empty codec bytes, fallback order/extra fields, call counts and
   mutation isolation; retain the existing codec oracle.
5. [x] Run the native public-entrypoint paired benchmark and seven validator
   controls with full output equality, base/base controls, two warmup/seven
   alternating measured pairs, mixed totals, per-step phases/CPU and separate
   stringify probes. Preserve complete samples, signed variation and negative
   results; no extra samples were collected to seek a desired answer.
6. [x] Validate assembled native CLI JSON/TOON contracts and the unique real-Codex
   activity journey through production manifest/prompt/dynamic-tool contracts.
7. [x] Record final measured evidence in the benchmark README and this active
   plan; retain member changelog wording and associate the fragment with PR4018.
8. [x] Parent: complete the native tests, typechecks, builds and guards listed below.
   Accept the measured serialization reduction and targeted summary-stage gains;
   do not claim universal whole-rebuild gains or omit deferred global work.
9. [x] Parent: run and inspect the unique live journey using local subscription
   `gpt-6.1-sol`; record actual reply, tool, fact and effect evidence. UX Ready.
10. [x] Final round 1 full sensitive ReviewGPT PASS on
    `3f6b207683808089108e0d0df2b6ca0fe6b54d9e` with Hercules `gpt-6-pro`:
    no findings, zero accepted/rejected ([review](https://chatgpt.com/c/6ac3bb7c-cc88-83e9-8d42-e2a0d3360f01)).
11. [x] Required CI PASS on pre-closeout head
    `3a83209c70e996a685a1d6c4bb31743dc0997761`, verified before applying this closeout.
    Required exact-head CI for the final closeout commit remains a PR handoff gate.

## Incremental additions and rejected work

- Blood-test list acquisition delegates to the existing event-only reader.
  Classification/text/status/date/order/limit and alias selectors are unchanged.
  Tests cover cold/fresh/stale/empty, corrections/deletions/reclassification,
  selected-source failures, unrelated-family isolation, lock capture/reentrancy
  and subsequent explicit global work. Stale/absent repeats still read strict
  current events; they do not publish wearable rows or certify global freshness.
- Browser Vault source health and assistant summaries share one default bundle.
  Personal Patterns shares it only when default filtering removes no entities;
  otherwise its original raw input gets a separate bundle. Actual derivations
  fall 3→1 for equivalent default-visible input and 3→2 when raw input is needed.
  The public assistant wrapper, journal input, timestamps, hash, visibility and
  four cancellation yields retain their owners. Tests cover input/bundle
  immutability, actual derivation counts, complete output/dataVersion parity,
  raw/filtered input and each cancellation checkpoint. Separate journal/source
  corrections are outside this PR; both input variants remain supported.
- The one-pass metric deletion is **rejected for this PR**. Actual exported
  producers admit a Unicode-date ordering counterexample: locale-equal composed
  and decomposed dates can produce different aggregate order when producer groups
  are sorted first. The public-path regression passes, with canonical mixed,
  duplicate and colliding-id differentials retained. No metric source, comparator,
  accepted-input contract, suppression or hash change is included. Necessary
  metric identity operations remain 8,100; no 8,100→5,400 claim is made.
- The incremental control applies only the original authored query-projection
  and codec postimages to the original baseline, holding envelope reuse constant.
  The incremental candidate also includes the narrow fresh-global correction;
  its comparison must not be attributed to blood/browser changes alone.
- The validator was simplified into distinct evidence, phase and stringify
  contracts. Parent verification reports complexity 33→8, helpers 8/15/5, seven
  controls PASS, semantic benchmark typecheck PASS and complexity guard PASS.
  Timed `runTrial` and paired-driver bytes are identical to the measured version;
  the README records both whole-harness hashes. All assertions, phase transitions,
  full-byte equality, scenarios and invocation remain unchanged.

## Measured evidence and accounting

Complete reproducible commands, supplied medians, output sizes and accounting are
in [`global-projection.md`](../../../packages/vault-usecases/bench/global-projection.md).
The private local reports retain all seven samples, min/median/max, signed paired
deltas and per-step wall/CPU/phase variation; the summaries do not select favorable
samples. Phase spans overlap and must not be summed into total elapsed time.

All four candidate timing/probe runs completed: ten original and nine incremental
scenarios (17 unique), each with two warmup and seven alternating measured pairs.
The same 90-day, three-provider fixture contains 2,160 observations, 270 sleep
sessions and 90 notes; blood scenarios add one synthetic panel. Native built
public entrypoints use the same seeded path/mtimes. Complete JSON/hash/phase
checks pass before full JSON is stripped from private local reports. Cold imports,
source preparation, edits and later global work remain charged. Base/base controls
were captured October 2 and candidate paired comparisons October 5 on a busy
shared host. The October 5 paired before/after comparisons use the same measurement
method under concurrent shared-host load; they are not production estimates or
comparisons against an October 2 timing baseline.

Cold latest/activity/recovery and blood lists, and the filtered Browser Vault
builder, show the measured improvements recorded in the README. Mixed workflows
do not show a general speedup: wearable→global medians are 1907.79→1947.51 ms and
blood→global 1300.04→1307.16 ms. Cold full-global medians are 1293.90→1210.88 ms;
edited full-global workflow medians are 1821.13→1865.55 ms, with signed paired
deltas from −504.86 to +471.59 ms. Whole edited-global wall improvement is
inconclusive. Fresh-global ordinary reads remain comparable; focused wearable-only
repeats pay their existing lock plus the explicit global preflight, about 4–6 ms
extra in this fixture. Raw Browser Vault whole-workflow timing is nearly unchanged
at 969.99→957.17 ms even though its builder median is 302.32→284.10 ms.

The finite expected-empty codec eliminates 13,715 cold or 13,770 warm JSON
serializations. Cold full-global calls fall 64,072→50,357 and edited-rebuild calls
64,021→50,251. Cold and edited wearable-summary stage medians improve. This is
valid targeted work reduction, with no robust whole edited-rebuild wall gain
claimed. No necessary work, result fields, ordering, provenance or facts are
removed to obtain the measurements.

A parked-writer reproduction exposed and removed the proposed fresh-global lock
regression: old read 21.46 ms, initial candidate 407.87 ms, corrected candidate
15.80 ms, with identical 67,645-byte output. These single timings establish
blocking behavior, not a production speedup. Deterministic barriers cover all
eight readers, empty providers and the focused sleep/source controls. Commit/
rollback, reentrant pre-commit publication, post-status writes/reset races, direct
errors and atomic row/dictionary capture preserve the original correctness
boundary. The source-only lock remains a limitation; aggregate waits do not
identify lock holders.

## Completed parent verification and remaining risks

The following results are independently reported by the parent for the supplied
evidence head; they are not new native runs by this documentation author:

- Query: 133 PASS, one existing skip; usecases: 14 PASS; native activity/blood CLI:
  3 PASS. Seven dependency-free negative benchmark-validator controls PASS.
- Query/usecase/assistant/benchmark semantic types and dependency/native CLI builds:
  PASS. Workspace cycles/boundaries/dependency policy, documentation drift and
  raw-log guards: PASS. Changelog generation and ten page tests: PASS.
- Real-Codex focused activity: local subscription `gpt-6.1-sol` PASS. The parent
  inspected the actual concise reply reporting 8,800 Oura steps. The journey made
  one native data read, with no unrelated lookup, write, provider call or delivery.
  Parent UX verdict: Ready. Exact Opus 5.5 investigative advice did not change the
  runtime model.
- The already-fixed fractional-mtime snapshot test: 1 PASS, 38 SKIPPED. This PR
  makes no restore change. Exact device redeliveries already skip writes. The
  repeated-rebuild screen found no grouped rebuild count greater than call count;
  that bounded result does not prove all redundant rebuilds are absent.

Main risks remain partial projection accidentally certifying global state,
weakened strict validation, provider/date evidence loss, decoder aliasing and
misleading mixed-workflow timing. The negative tests and full-byte/phase proof
target these boundaries. Finite module initialization is charged on cold import;
necessary global rebuilds remain synchronous, and the fallback's extra preflight
is explicitly measured. No stale-while-refresh policy or optimistic wearable-only
capture is introduced. Final ReviewGPT and pre-closeout CI are recorded above.
The reviewed head remains immutable. The normal current-main merge conflicted
only in the index and retained both sides' literal prose; all five optimized
production files remain byte-identical to the reviewed head. Required exact-head
CI for the final closeout commit remains a PR handoff gate. Archival does not
claim overall PR completion or authorize merge or deployment.
Completed: 2026-10-05
