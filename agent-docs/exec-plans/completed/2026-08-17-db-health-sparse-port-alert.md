# Stop sparse PlanetScale port series from paging operators

Status: completed
Created: 2026-08-17
Updated: 2026-08-17

## Goal

- Keep real database-pressure and connection-error pages intact while a missing
  single-port PlanetScale counter series remains diagnostic and does not page
  operators by itself.

## Success criteria

- A scrape with only port 5432 or only port 6432 remains a usable observation.
- An observed positive counter delta still pages for its exact port category.
- The complete absence of the connection-error metric family still participates
  in the existing bounded confirmation and two-check telemetry page.
- Per-port baselines advance only for observed series, so a later reappearance
  cannot replay an old or unknown delta.
- Focused Node and Workers tests, Cloudflare typecheck, ReviewGPT, and required
  PR checks pass.

## Scope

- In scope: PlanetScale metric completeness classification, focused monitor and
  parser tests, and the current architecture, reliability, testing, and
  Cloudflare operator docs.
- Out of scope: changing database limits, alert delivery, pacing, recipients,
  provider credentials, or the five-minute schedule.

## Evidence

- Production checks repeatedly parsed all other required metrics and the 6432
  connection-error series while only the 5432 series was absent.
- The current parser marks the whole family missing when either expected port
  is absent. Two affected checks therefore create a telemetry page despite no
  concrete pressure condition.
- PlanetScale documents the metric family and its port label, but does not
  guarantee that every possible port label is present in every scrape.

## Decisions

- Treat the family as present when at least one supported port series is
  present. A single missing port is sparse label cardinality, not collection
  failure.
- Preserve the existing observed-only per-port baseline and delta behavior.
- Keep complete family absence fail-closed through the existing confirmation
  and telemetry-page path.
- Keep sparse-port detail transient during unrelated collection failures. Clear
  its durable missing-port count unless the whole family is missing, so rollback
  Workers retain the existing family/evidence correlation contract.
- Handle the reachable confirmation outcomes directly. The parser now makes a
  partial original connection-error family impossible, so no composition state
  or duplicate confirmation evaluation remains.
- Add no new state, queue, service, retry, or alert lifecycle.

## Tasks

1. [x] Add regressions for safe sparse-port observations and real observed-port
   deltas.
2. [x] Change completeness classification at the metric parser boundary.
3. [x] Align durable owner docs with the new alert rule.
4. [x] Run focused proof, push a PR, complete ReviewGPT and CI, then archive this
   plan through the normal final commit.

## Completion evidence

- Focused Node tests passed 115 tests. The Workers runtime file passed 5 tests.
- Cloudflare typecheck, durable-doc drift, and diff checks passed.
- The preliminary specialist finding about rollback compatibility was accepted
  and fixed. No patch artifact was returned.
- Final ReviewGPT round 1 found obsolete confirmation composition. The accepted
  correction removed that helper and duplicate evaluation. Round 2 passed with
  no findings.
- Exact-head CI passed every relevant app, package, build, type, fixture,
  artifact, and policy check except the hosted Web app aggregate. That aggregate
  is blocked by the unchanged date-sensitive
  `browser-training-view.test.ts`; its focused test fails identically outside
  this diff on 2026-08-17.
Completed: 2026-08-17
