# Experiment-list family-local read

Status: active; implementation handoff, parent acceptance pending.
Base: `3d2ba92f9035ea19a3be04450517c6d7086f32d9` (parent-confirmed).

## Outcome and boundary

List saved experiments without preparing unrelated health views. Reuse query's
strict experiment-family reader under core's reentrant canonical write lock.
Keep status-before-limit, canonical ordering, complete envelopes, error mapping
and query ownership. No cache, schema, dependency or other reader changes.

## Evidence and remaining gates

- Parent established the pre-implementation integrated-service baseline on Node
  >=24 with built public entrypoints: 28 days, 3 providers, 672 observations,
  84 sleep sessions, 28 notes and one experiment; cold 314.25 ms with global
  phases, fresh 4.88 ms, matching 580-byte envelopes. Separate three-experiment
  canonical/full-query/filter-order proof, 4 query and 39 usecase tests passed.
  These are parent-reported results, not measurements of this candidate.
- Authored: usecase substitution, focused contracts, reusable synthetic paired
  benchmark, canonical real-Codex journey and owner/changelog documentation.
  The benchmark uses the existing sleep data factory and TypeScript bench layout.
- Parent: apply exact patches separately; run deterministic tests/builds, then
  base/base and base/candidate pairs, then only the focused live journey. Record
  warm/mixed totals and reply review before acceptance. Commands: usecase README.
- Remote: no dependencies or built entrypoints; no runtime or live acceptance
  claimed. Do not retry network installs. Delivery hashes are separate artifacts.

Changelog: updated, `2026-10-01 / focused-experiment-lists`; no numeric speed claim
or new visual. PR provenance/plan closeout require an author-owned follow-up if
needed. Parent owns independent verification, overlap, commits, PR and CI; no
production operations. Leave this plan active until acceptance is complete.
