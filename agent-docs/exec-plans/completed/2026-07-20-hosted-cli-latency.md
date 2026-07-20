# Hosted CLI Latency

## Goal

Reduce hosted blood-test answer latency on the existing one-vCPU runner without
adding a second source of truth, weakening snapshot correctness, or overlapping
the active runner-container lifecycle lane.

## Constraints

- Keep the hosted runner at one vCPU.
- Preserve canonical vault files as authority; SQLite remains a derived cache.
- Preserve query-projection freshness validation after restore.
- Snapshot only the query SQLite database and its WAL/SHM companions, not the
  rest of `.runtime/projections/**`.
- Do not edit `apps/cloudflare/src/runner-container.ts` or its focused tests.
- Keep runtime telemetry metadata-only and causally named.

## Work

1. Route blood-test list/show through the filtered query projection and expose
   its existing text filter through the typed CLI surface.
2. Carry the freshness-validated query SQLite triplet through encrypted hosted
   workspace snapshots while leaving other rebuildable projections excluded.
3. Inspect the actual Codex command-execution boundary and add the smallest safe
   repeated-read optimization available without creating a daemon or persisted
   health-data result cache, including aligned snapshot and routed-skill guidance
   for one targeted named-biomarker read.
4. Split direct-wake timing into causal Durable Object/fence/container phases at
   the controller and contract owners, without changing runner lifecycle policy.
5. Add focused regression coverage, direct performance/correctness proof, and
   update the durable architecture/runtime documentation.

## Verification

- Focused and package-owner tests pass across query, CLI, runtime-state,
  hosted-execution, assistant-engine, hosted-local, and reverse dependents.
- All 20 affected typechecks pass. `pnpm test:apps` passes the full web and
  Cloudflare verification lanes, including builds, smoke checks, and 7,725
  app tests.
- The broad `pnpm test:diff` lane exposed two pre-existing preparation gaps:
  ignored generated Health Commons artifacts and a missing built
  `assistant-runtime` dist after `build:test-runtime:prepared`. After preparing
  those expected artifacts, the equivalent affected package and harness suites
  all pass.
- The required `coverage-write` audit returned zero findings and made no edits;
  the existing deterministic tests cover routing, snapshot inclusion/restore,
  telemetry serialization, and same-turn read guidance.
- Complete parent final review, privacy/diff scan, scoped finish-task commit, PR
  CI, and the exact-head ReviewGPT loop.

## Measured Proof

- On the private diagnostic fixture, the targeted blood-test read takes about
  3.48 seconds when it must rebuild the projection and about 0.25 seconds when
  the restored query cache is fresh.
- The encrypted query-cache exception remains derived state: canonical files
  stay authoritative, source-manifest validation still controls freshness, old
  snapshots remain accepted, and no other projection is included.
- The hosted runner resource configuration remains one vCPU.
Status: completed
Updated: 2026-07-20
Completed: 2026-07-20
