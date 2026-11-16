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

- Rebased on the published BE0 contract at `9ceaa81ba4` (PR #5061).
- Worker storage, HTTP and runtime purge: 18 tests passed, exit 0, including
  before/after-upload retirement and owner/scope rejection.
- Web focused suites: 258 tests passed, exit 0. They cover provider and geometry,
  route rollover and identity, picture ownership, JPEG validation, GET/DELETE
  contracts, account deletion, shared contract and control-client mocks.
- Shared control client/routes: 107 tests passed, exit 0.
- Web, Worker, hosted-execution and cloudflare-hosted-control typechecks passed,
  exit 0. Complexity diff passed, exit 0; existing client hotspots are unchanged.
- Live Mapbox: permanent geocoding succeeds; San Diego to San Francisco returns
  Ok; London to New York returns NoRoute. No private input or token was retained.
- Styles create/list both return HTTP 403. Style JSON is prepared outside the
  repository for the owner to upload in Studio. Awaiting the resulting style id.
- BE1/BE2 current-total reader composition is pending. `setRouteGoal` takes a
  required fifth context argument containing complete canonical points, awards,
  completeness and mutation authority; it does not introduce a totals reader.
- The shared patch writer now also accepts a synchronous computed patch evaluated
  against its observed state. Route awards use frozen route identity, so an old
  completion cannot attach to a replacement at the same array index.
- The first diff-scoped remote check is still running against the earlier
  foundation head. The final integrated candidate needs its own selector run.

## Remaining integration

- POST picture response needs the canonical measure series for `Pic.at`.
- GET map needs the canonical measure progress and uploaded Murph style id.
- BE1/BE2 must compose route views, first-route selection, route awards and photo
  pins into their reads and connect goals to the route preview/setter.
- Comparison PNGs and deployed token/style verification await the custom style.
- Keep PR #5060 draft and this plan active. Do not merge or run ReviewGPT.

## Signature and bounded-effect refinements

- Route rollover (rows 04/10) requires the caller's canonical series and current
  authority, hence the required setter context and computed state patch.
- Map preview (rows 04/15) adds the explicitly requested `from`/`to` query variant
  to BE0's parser and enforces Mapbox's documented 1280-pixel maximum.
- Account deletion retires at most 100 picture objects per member per request;
  successful pages are removed before an explicit continuation. No background
  job or automatic retry is added. This bounded cleanup behavior must remain
  visible in integration review; it is separate from incomplete award input,
  which settles nothing.
