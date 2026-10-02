# Experiment-list family-local read

Status: completed
Base: `3d2ba92f9035ea19a3be04450517c6d7086f32d9` (parent-confirmed).
Tracking: [issue #3965](https://github.com/cobuildwithus/murph/issues/3965),
[PR #3969](https://github.com/cobuildwithus/murph/pull/3969).
Parent-reported local-proof head: `9ab1ee8fd26787de44d024149eb6520a44565017`.
Review/CI input head at closeout preparation (parent-reported):
`f6277fe27cb2d918b72ed8ad15ef3061e5c3a928`.

## Outcome and boundary

List saved experiments without preparing unrelated health views. Reuse query's
strict experiment-family reader under core's reentrant canonical write lock.
Keep status-before-limit, canonical ordering, complete envelopes, error mapping
and query ownership. No cache, schema, dependency or other reader changes.

## Evidence and completion gates

- Parent established the pre-implementation integrated-service baseline on Node
  >=24 with built public entrypoints: 28 days, 3 providers, 672 observations,
  84 sleep sessions, 28 notes and one experiment; cold 314.25 ms with global
  phases, fresh 4.88 ms, matching 580-byte envelopes. Separate three-experiment
  canonical/full-query/filter-order proof, 4 query and 39 usecase tests passed.
  These are parent-reported results, not measurements of this candidate.
- Authored: usecase substitution, focused contracts, reusable synthetic paired
  benchmark, canonical real-Codex journey and owner/changelog documentation.
  The benchmark uses the existing sleep data factory and TypeScript bench layout.
- Independent final focused proof, supplied by the parent for the local-proof head above:
  usecase contract 22 PASS; existing reader/lifecycle 39 PASS; query reader/lock
  18 PASS; production CLI with assembled manifest, JSON and default TOON 2 PASS;
  changelog 10 PASS. Dependency build, usecase and assistant-engine typechecks,
  and benchmark typechecks in both BASE and CANDIDATE PASS.
- Complexity guard PASS: no hotspots in the changed list function; other reported
  hotspots at 38/35/26/22 are unchanged.
- Focused real-Codex journey PASS on `gpt-6.1-sol`, local subscription: exactly
  one list read, no unrelated reads, writes or outbox effects, canonical bytes
  unchanged. Reply review: Ready for the supplied synthetic sample; it correctly
  and concisely named both active experiments without extra advice or claims.
  This single live sample is not a guarantee for future model runs.
- Base/base and base/candidate benchmarks COMPLETE: six isolated-process scenarios
  each, two warmup pairs and seven alternating measured pairs per scenario.
  Complete list/global envelopes were identical; the cold list was 14,042 bytes
  on both revisions. The 30-day, three-provider fixture contains 720 observations,
  90 sleep sessions, 30 notes and 12 experiments. Cold-list native SQLite method
  calls fell from 1,437 to zero (not unique SQL); global rebuild/source/dataset/
  metric/summary/search/publication phases disappeared from lists, not global
  reads. Measured timings, control variation and warm/mixed limitations are in
  the [usecase README](../../../packages/vault-usecases/README.md#focused-experiment-lists).
- The results above are parent-run local proof, not remote reruns.
  [PR #3969](https://github.com/cobuildwithus/murph/pull/3969) is authoritative
  for the validated final ReviewGPT result, required finding disposition,
  exact-head CI (including any closeout head) and final mergeability.
  Archiving this local-proof record does not assert those gates passed or
  authorize merge, deploy or production operations.

Changelog: updated, `2026-10-01 / focused-experiment-lists`, source PR #3969;
no numeric production speed claim or new visual.
Updated: 2026-10-01
Completed: 2026-10-01
