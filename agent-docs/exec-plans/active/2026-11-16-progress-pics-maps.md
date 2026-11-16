# Progress pics and maps

Status: active
Created: 2026-11-16

## Outcome and scope

Implement the approved BE3 lane: owner-only sealed progress pictures with permanent
retirement; frozen driving or explicit-NoRoute routes, town labels, private map
images, route goals and route awards. The supplied locked Progress plan owns
product decisions. Shared schemas, crypto and measure-state writes belong to BE0;
game and health totals remain with BE1 and BE2. No duplicate totals reader,
background job, cache table, retry or feature flag.

## Product UX and proof

- Camera upload and replay: a picture belongs to one exercise and one owner.
- Viewer and delete: another member sees no bytes; a retired object cannot return
  through delayed upload. Account deletion retires objects before row cascades.
- Route preview and goal: road geometry, towns and distance resolve once; only
  explicit NoRoute uses a great circle. Provider errors return retryable 503.
- Route completion: crossing-day awards and finished legs survive total corrections.
- Map: cream land, light water, faint borders, tan remaining and sage walked paths;
  town positions share the PNG's Mercator viewport. Provider tokens stay server-side.

## Implementation and dependencies

- Reuse recap conditional writes and content-free tombstones with a separate
  Progress key namespace and resource kind. Consumer Worker deploy precedes Web.
- Rebase on the published BE0 contract; never duplicate its types or tables.
- Integrate current-total reads from their lane owners and one state CAS writer.
- Create/upload the Murph style and render the two checked comparison routes.
- Run synthetic geometry, provider, storage and HTTP contracts, affected
  typechecks, the requested diff selector, complexity review, and exact-head CI.
- Commit, push and open a draft PR against main; Ready after local checks. Do not
  merge or run ReviewGPT; review integration belongs to the integrator.

## Evidence and open dependencies

- Worker storage: 11 tests passed, including before/after-upload retirement.
- Map provider and geometry: 20 tests passed. Route rollover: 5 tests passed.
- Shared control client/routes: 107 tests passed. Shared-package typechecks passed
  before the latest client extraction; rerun on the candidate.
- Live Mapbox: permanent geocoding succeeds; San Diego to San Francisco returns
  Ok; London to New York returns NoRoute. No private input or token was retained.
- Styles create/list both return HTTP 403. Style JSON is prepared outside the
  repository for the owner to upload in Studio. Awaiting the resulting style id.
- BE0 remote and the BE1/BE2 current-total reader interface are pending. Picture
  service tests currently cannot resolve BE0's unpublished crypto module.
- BE0's patch writer must evaluate a leg-update function against its own observed
  state to avoid replacing legs derived from a stale caller read.
