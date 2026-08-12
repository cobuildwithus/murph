# Persist bounded Junction workout features

Status: completed
Created: 2026-08-11
Updated: 2026-08-11

## Goal

- Persist useful Junction workout detail as bounded canonical facts so Murph can
  answer split, cadence, power, and swimming questions without retaining raw
  workout timeseries.

## Success criteria

- Bounded `workout_duration`, `workout_distance`, and
  `workout_swimming_stroke` resources normalize with exact provider attribution.
- Shallow `workout_stream` webhooks fetch one exact workout stream and reduce it
  in memory to capped summary facts and fixed-distance splits.
- The vault receives no raw stream arrays, route coordinates, downsampled
  samples, inferred zones, or generic provider snapshot fallback.
- Importer and provider focused tests, core round-trip proof, and package
  typechecks pass.

## Scope

- In scope: Junction resource policy additions needed by this lane; dedicated
  workout-stream transport; bounded workout feature normalization; tests and
  wearable compatibility documentation.
- Out of scope: route polylines or coordinates, full or downsampled timeseries,
  inferred interval/zone semantics, UI changes, and non-Junction providers.

## Constraints

- Technical constraints: keep provider transport, importer normalization, and
  core persistence ownership separate; cap response bytes, input points, split
  facts, and retries; use stable sibling external-reference facets rather than
  overwriting the existing workout session.
- Product/process constraints: preserve privacy, use synthetic fixtures, avoid
  direct identifiers, and leave commit/push/PR/ReviewGPT work to the parent.

## Risks and mitigations

1. Risk: a dedicated stream becomes an accidental second raw timeseries store.
   Mitigation: reduce before importer handoff and assert forbidden arrays and
   canonical samples are absent.
2. Risk: sparse records attach to the wrong workout.
   Mitigation: require explicit workout identity for linked facts and never
   infer a duration link from temporal overlap.
3. Risk: large provider responses consume unbounded memory or vault space.
   Mitigation: enforce transport byte and point caps plus fixed output caps.

## Tasks

1. Add the minimal Junction catalog and transport seams for the three sparse
   resources and the dedicated workout stream.
2. Implement pure bounded reduction and importer normalization to stable
   measurement facts.
3. Add provider, importer, and real core round-trip regression coverage.
4. Update device-provider compatibility documentation and run focused checks.

## Decisions

- Dedicated stream data is fetched only from an exact shallow-webhook workout
  identity; scheduled reconciliation does not fan out per workout.
- The shared contracts policy is the sole resource catalog: workout duration
  uses sparse per-record retention with bounded history chunks, while workout
  distance and swimming stroke use bounded feature retention.
- Route coordinates and raw/downsampled point arrays are discarded before the
  importer boundary.

## Verification

- Commands to run: focused device-syncd/importer/core tests and package
  typechecks selected after the touched-file graph is final.
- Expected outcomes: all checks pass and tests prove bounded output plus the
  absence of canonical samples/raw arrays.
- Completed proof: four focused Junction importer tests, the real core-port
  workout-feature round trip, five exact-stream/sparse-history provider tests,
  six contracts-policy tests, thirteen Junction catalog/config/manifest tests,
  and all three touched-package typechecks pass.
Completed: 2026-08-11
