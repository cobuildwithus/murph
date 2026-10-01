# Journal correctness and projection efficiency

Status: completed
Created: 2026-09-06
Updated: 2026-09-06

## Outcome and architecture

Find and fix reproducible Journal data/refresh defects and remove measured
unnecessary work. Retain canonical event/metric owners, query-owned projection,
Browser Vault publication, and the existing website. No new persistence,
service, dependency, model call or production mutation.

## Investigation

Three independent subagents reviewed projection correctness, refresh recovery,
and projection cost. After review, the first added regression tests and the
second implemented the scoped page recovery fix and composed tests. The third
ran ignored synthetic benchmarks. Parent reviewed their output and owns query
changes, browser proof, final review and commit. Existing UI commit stays intact.

## Product UX

- Entry and promise: open Journal to see accurate recent health context, navigate
  dates, and inspect summaries without misattributing records or missing data.
- Journeys: main sleep plus naps, linked events, sparse/dense wearable history,
  loading/empty/stale replicas, date boundaries and missing daily chart samples.
- Proof: synthetic query regressions, composed Browser Vault tests where affected,
  parent-reviewed before/after timing and rendered evidence for any UI change.
- Done when: accepted defects fail before and pass after, optimizations preserve
  output, and focused tests/typechecks/review pass.
- Exclusions: production inspection/mutations, new capture behavior, auth changes,
  unrelated historical code, deployment and publishing.

## Decisions and evidence

- Accepted: observation dates could disagree with normalized metric dates and
  merge adjacent sleep nights through record links. Journal now reuses the
  canonical date resolver, retaining timestamp-only fallback.
- Accepted: the duration catalog used `total-sleep` instead of canonical
  `total-sleep-minutes`; duration-only observations were missing from statistics.
  The catalog and duplicate suppression now use the canonical key.
- Accepted: raw observation values could replace normalized duration values.
  Journal now uses canonical extraction for in-window observations, including
  aliases, unit conversion and incompatible-unit rejection.
- Accepted: an explicit main sleep plus one short unlabeled session swallowed
  the nap. Only choose an unlabeled main when no explicit main exists, retaining
  the existing long-duplicate rule. Five agent regressions failed before fixes.
- Accepted: first-import `empty` plus pending import skipped both provider
  polling and page refresh. Journal now joins its existing bounded refresh
  window. Existing server handling suppresses a competing runtime wake during
  import. Repeated unavailable-state retries cannot reset an active deadline.
  Composed tests proved initial publication, timeout and retry failures first.
- Accepted: UTC+14 shifted chart weekday labels because a date-only value used
  the browser zone. Chart labels now use UTC for the date-only formatting.
- Efficiency: partition in-window metric points in one history scan, clip
  experiment iteration while preserving original progress, and reuse formatter
  instances per projection. No persistent cache or new dependency.
- Avoided: extracting every historical observation initially regressed a
  20,075-observation fixture from roughly 32 ms to 250–288 ms. Moving extraction
  after the canonical date filter removed that regression without another index.

### Synthetic performance evidence

Six optimization fixtures retained identical output hashes. Both observation
histories matched the corrected normalization output. Timings varied with
machine load; deterministic work counts are the strongest evidence.

| Fixture | Before | After | Deterministic work |
| --- | ---: | ---: | --- |
| 1,440 timed notes over 120 days | 263.1 ms | 39.5 ms | 2,640 formatter constructions to 1 |
| 54,750 historical metric points | 65.25 ms | 25.25 ms | Eleven history scans to one partition pass |
| Ten-year experiment phase | 5.55 ms | 1.2 ms | 4,042 ISO conversions to 260 |
| Future phase outside window | 5.15 ms | Below timer precision | 3,656 ISO conversions to 2 |

These are local synthetic projection measurements, not production page-load
claims. The final five-year observation median was 74.85 ms versus 54.65 ms
baseline under noisy load; current-window canonical normalization adds real
correctness work. There is no claim that every input is faster.

## Verification and delivery

- Query Journal, replica, shard, device metric and metric-point tests: 64 passed.
  The final Journal-only run passed 25 tests after correcting a fixture title.
- Web provider/context, dashboard and navigation tests: 114 passed.
- Changelog fragments and production archive rendering: 16 passed.
- Query and Web typechecks passed. A new fixture initially omitted a required
  title argument; corrected and rerun.
- Complexity guard passed with no hotspots above 20; Journal source maximum
  fell from 19 to 18. Scoped Web ESLint and whitespace checks passed. Root
  `pnpm exec eslint` is unavailable; lint uses the declared Web entrypoint.
- Chromium journey passed at 320, 390 and 1280 pixels, including native calendar
  keyboard activation, selected-week summaries, today, empty refresh status,
  overflow and chart weekdays after switching to Pacific/Kiritimati.
- Parent inspected the rendered 320-pixel timeline and phone/desktop chart
  captures. The chart retains Sunday–Saturday labels in UTC+14. A development
  issue badge overlays part of the phone chart capture; desktop labels and
  browser assertions independently verify the corrected dates. Captures remain
  ignored local proof, with no production data.
- Product UX: Ready. First-import success
  reveals entries, timeout exits preparing, stale/legacy retries stay bounded,
  and existing readable dashboard flows remain covered.
- Parent reviewed source/test diffs, canonical ownership, auth and refresh
  boundaries, synthetic evidence and privacy. No new state schema, external
  call, foreground reply work, AI behavior or dependency.
- Journal product owner updated. Changelog item:
  `2026-09-06 / journal-sleep-and-import-recovery`.
- Logged catalog-only date hydration friction at
  `.agents/friction-log/20260906154117-design-catalog-date/friction.md`.
  The chart proof switches zones after catalog hydration to isolate the real
  Journal component from that unrelated synthetic study.
- Delivery boundary: scoped local commit. No PR, remote CI, final ReviewGPT or
  deployment ran; those are future publishing gates, not local proof.

Completed: 2026-09-06
