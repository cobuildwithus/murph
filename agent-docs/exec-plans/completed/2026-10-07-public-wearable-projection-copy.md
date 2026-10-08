# Public wearable projection direct copy

Status: completed
Created: 2026-10-07
Updated: 2026-10-07
Pull request: #4084

Reviewed-head CI and the mandatory final ReviewGPT review passed. Merge is
user-authorized, subject to fresh exact-head CI after this docs-only closeout. An
earlier ReviewGPT authoring attempt failed before submission (model selector
option not found); the qualified fallback authored the tracked changes.

## Goal

- Remove the per-summary `JSON.stringify`/`JSON.parse` round trip from
  `projectPublicWearableSummaryBundle()`, the last step of multi-provider
  wearable composition, without changing any public or persisted output.
- Measurable outcome: lower CPU for that projection step on the synthetic
  365-day bundle in `packages/query/bench/wearable-cpu.ts`, compared against the
  text round-trip control in alternating pairs. That measurement, local or
  parent, is synthetic only and does not establish production latency; this
  plan makes no production latency claim.

## Success criteria

- Every projected summary deep-strictly equals and byte-equals the text
  projection (`stringifyPublicWearableProjectionSummary()` then
  `parseJsonValue()`), including key order, `-0`, non-finite numbers,
  omitted `undefined`/function/symbol values and `__proto__` own properties.
- Privacy is unchanged: provenance keys are omitted and `candidates`, `paths`
  and `recordIds` are emptied at every depth, with fresh containers.
- Failure behavior is unchanged: bigint and cyclic input still throw the same
  `TypeError` from the text path.
- Parent exact-base synthetic measurement, real-Codex focused verification,
  exact-head CI and final review pass.

## Scope

- In scope: `packages/query/src/projection/wearable-summary-public-json.ts`,
  its isolated regression test, the bench case and README, the query owner note,
  one focused activity journey reusing the existing real-Codex fixture, and the
  changelog fragment.
- Out of scope: stored rows, the stored codec, the stringify function, public
  schemas/types, prompt and tool surfaces, and the fresh-global stored read.

## Constraints

- Producer boundary: the composer passes typed `WearableSummaryBundle` values
  built from plain object literals and arrays. They define no getters, proxies
  or `toJSON`; the copy relies on that and does not claim to support them.
- Values outside the plain shape (non-`Object`/`null` prototype, `toJSON`,
  bigint, depth 32 or more, cycles) fall back to the exact text path for the
  whole summary. A fallback rereads accessors; the current producer has none.
- Production schemas and types stay strict. Malformed test inputs use one
  focused `@ts-expect-error` at the intentional invalid argument.

## Risks and mitigations

1. Risk: a semantic mismatch with `JSON.stringify` changes public bytes.
   Mitigation: parity tests against the text projection on composed
   multi-provider summaries and on edge values, plus bench result equality.
2. Risk: a privacy key leaks through a new path.
   Mitigation: the copy shares `WEARABLE_SUMMARY_PROVENANCE_KEYS` and the same
   key precedence; tests check every depth and array element.
3. Risk: the provider-filtered real-Codex fixture bypasses the changed composer.
   Mitigation: a second journey on the same fixture reads without a provider
   filter, so two providers compose.

## Tasks

1. Implement the direct copy with text-path fallback. Done.
2. Add isolated regression tests and the paired bench case. Done.
3. Add the query README owner note and changelog fragment. Done.
4. Add the composed activity journey and native JSON/TOON contract case:
   `--from 2026-01-02 --to 2026-01-03 --limit 2`, no provider. Expected: two
   days; 2026-01-03 selects Garmin 12300 over conflicting Oura; 2026-01-02 is
   Oura 6200; Oura 8800 is absent. Exactly one native activity read, no dynamic
   tools, writes, outbox intents or global publication. Done; determined from
   the service output.
5. Parent: exact-base measurement, getter/fallback reachability review and
   real-Codex run. Done. Reviewed-head CI and final review. Passed.

## Decisions

- Changelog: `2026-10-07 · multi-device-wearable-reads`, a sober faster
  cross-provider wearable lookup note with the same sources and readings,
  sourced from PR #4084. No numeric, production latency or broad privacy
  claim.
- Producer review: the parent inspected the composer and fallback. The
  composer produces plain objects with no getters or proxies; fallback
  semantics are as documented under Constraints.

## Measurement

Synthetic only; no precise production speedup is claimed.

- Clean exact baseline `138cf8303d` against candidate source `e034d30dcf`.
- Seven alternating baseline/head process pairs, each 2 warmups and 4 measured
  reads through the actual public Patterns runtime, on a synthetic bundle of
  365 days, 3 providers, 8760 observations and 1095 sleep records plus factors.
- Warm per-process median across the 7 pairs: 510.277 ms to 456.604 ms (base
  range 506.908–518.191 ms, head 451.228–462.991 ms). Paired delta median
  -55.312 ms (range -65.265 to -46.775 ms).
- Composition: 394.305 ms to 341.386 ms.
- Three baseline/baseline control pairs: ratio median 1.0037 (range 0.9898 to
  1.0266).
- Full output hashes and size (31738 bytes, 18 factors, 4 outcomes) were
  identical in every run.
- Synthetic result: about 10.5% lower whole-read elapsed time and 13.4% lower
  composition elapsed time. This does not explain the full production tail.

## Residual investigation

Issue #3997 stays open for the remaining latency tail.

- Existing phase telemetry from PR #4017 is deployed (source `ec9ede5a5e`
  includes it; protected release succeeded). No deployment was made by this
  task and no new telemetry patch is needed while those phases gain traffic.
- First new-phase arrival was 2026-10-06 08:30 UTC, so the full 72-hour window
  closes 2026-10-09 08:30 UTC.
- Early data: 28 new-phase calls show compose 31.789 s, hydrate 10.729 s and
  report 4.879 s. Two single calls over 5 s total 13.734 s, including
  freshness 3.763 s (one rebuild 3.626 s), metric 4.284 s and compose 2.861 s.
  The multi-call profile's 24.490 s tail cannot be paired with aggregate phase
  maxima.
- Follow-up: a bounded metadata review after the 72-hour window for residual
  startup, rebuild, hydration and contention. This optimization is not claimed
  to explain the prior 49 s observation.

## Verification

- `pnpm complexity:diff`: passed after extracting the record copy loop into
  `copyPublicPlainRecord()` (file max 18, debt 0); no suppression or ratchet
  change.
- Implementer: full query suite 967 passed, 1 skipped.
- Parent, independently:
  - Focused query tests: 99 passed, 1 skipped. Public copy tests: 5 passed.
  - Native production JSON/TOON contract cases: 2 passed.
  - Query, bench and assistant-engine typechecks: passed.
  - Actual public CLI dependency build: passed.
  - Complexity: file max 18, debt 0, passed.
  - Changelog tests (10) and docs drift: passed.
- Live journeys, each passed once on `gpt-6.1-sol` with local subscription
  auth, synthetic fixture only:
  - `answers composed multi-provider step days from one native read without other lookups or effects`
  - `answers one Oura step day from one native read without other lookups or effects`

  Actual replies were reviewed Ready, with exact selected source, day and step
  counts, one native read each and no other lookups, writes, outbox intents or
  dynamic tools.
- Reviewed-head CI on `1d23715112f290bc5f84c302c6a90f92376a2c29`: all four
  required contexts passed. CLI macOS/Linux and Release checks: run
  `37708081598`; billing: run `37708081634`.
- Final ReviewGPT 0.5.153 round 1: PASS on the same reviewed head; no accepted
  findings. [Review](https://chatgpt.com/c/6ac6f1c2-80d8-83ea-a5c3-ea453b06b4d6).
  User-authorized ephemeral registry invocation on Hercules, with existing
  config/preflight preserved and repository dependency pin unchanged.
  Selected GPT-6 Pro; sent request verified `gpt-6-pro`.
  Request sent 2026-10-08 01:28:30 UTC; capture completed after
  2026-10-08 01:35:39 UTC (>7 minutes; exceeds 180 seconds).
  Exact-turn response signature confirmed; all nine changed files passed
  full-snapshot hash/hunk verification. Reviewer reported 5,000 differential
  comparisons and isolated projection/edge-case checks, not full workspace
  or live reruns. Existing parent evidence remains authoritative.
- Merge readiness: reviewed head is merge-tree clean against main
  `236b2778161d37a715f84abf1098e28527cf3158`; user authorized merge after
  review. Fresh exact-head CI is required after this docs-only closeout and
  before merge. Those checks and merge are not complete. No manual deployment
  was requested or performed.
Completed: 2026-10-07
