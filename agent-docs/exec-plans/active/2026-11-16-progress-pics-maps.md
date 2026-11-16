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

- Stacked on BE1 at `55df03e617` (PR #5063), which includes BE0 at
  `9ceaa81ba4` (PR #5061), to reuse the canonical game series.
- Worker storage, HTTP and runtime purge: 18 tests passed, exit 0, including
  before/after-upload retirement and owner/scope rejection.
- Integrated Web focused suites: 322 tests passed across 14 suites, exit 0.
  They cover provider and geometry, route rollover and identity, picture
  ownership, JPEG uploads and local-day pins, map HTTP contracts, account
  deletion, shared contracts and BE1 game/goal/award composition.
- Shared control package: 114 tests passed, exit 0.
- Web, Worker, hosted-execution and cloudflare-hosted-control typechecks passed,
  exit 0. Complexity diff passed, exit 0; existing client hotspots are unchanged.
- Live Mapbox: permanent geocoding succeeds; San Diego to San Francisco returns
  Ok; London to New York returns NoRoute. No private input or token was retained.
- Styles create/list both return HTTP 403. Style JSON is prepared outside the
  repository for the owner to upload in Studio. Awaiting the resulting style id.
- BE1 composition is implemented. `setRouteGoal` takes a
  required fifth context argument containing complete canonical points, awards,
  completeness and mutation authority; it does not introduce a totals reader.
- The shared patch writer now also accepts a synchronous computed patch evaluated
  against its observed state. Route awards use the retained leg position plus
  frozen route identity, so neither an unfinished replacement nor a repeated
  completed leg can inherit another completion after totals shrink.
- Remote diff verification exited 5 before admission: the worker was unreachable
  during the 20-minute SSH bootstrap window. No test ran remotely.
- Local diff verification found two direct Zod imports (exit 1); changed them to
  the repository's public contracts entrypoint and reran the selector.
- That selector passed all six affected package suites and typechecks. Its Web
  run overlapped the cleanup-cap edit and reported two failures; a fresh
  four-suite run passed all 126 tests (exit 0), then ten suites passed all 258.
  The app-scoped selector was cancelled while queued for the shared host slot
  to integrate the newly published BE1 reader (selector exit 1, waiter 143).

## Remaining integration

- Upload the prepared Murph style in Studio and replace the explicit constant
  placeholder in `routes.ts` with its owner/style id. It is not deployable yet.
- Render the San Diego to San Francisco and London to New York comparison PNGs
  and verify the deployed server token/style. These await the custom style.
- Connect BE2's canonical health reader to the map handler when the lanes are
  combined. BE2's published `1758ac245a` already composes Steps initialization,
  settlement and views through these shared route helpers. The current map
  handler reads BE1 games. BE2 includes earlier BE3 commits and both lanes amend
  `view.ts`; preserve the latest BE3 route identity and picture changes when
  integrating instead of copying a second health totals implementation here.
- POST pictures, game pins, first routes, route goals/previews and completion
  medals are now wired. `setFirstRoute` takes one resolved route so a first read
  makes only one provider resolution for all missing game legs.
- The app-scoped selector passed the complete Web verify command: 15,616 tests
  passed, 2,792 skipped; typecheck, lint, dev smoke and production build passed.
  Worker verification initially failed nine existing recap contracts (selector
  exit 1). The shared storage refactor had changed rejection messages, stored
  record validation and normalized-envelope size checks. Restoring those
  existing recap boundaries preserves Progress's once-only request validation.
  Four focused Worker suites passed all 112 tests (exit 0). The Worker-only
  diff selector then passed typecheck and all 5,221 tests: 5,182 Node, 20 helper
  and 19 Workers-runtime tests (exit 0; two Node tests skipped).
- After that Web run, a reproduced repeated-route key collision (regression
  exit 1) was fixed with leg-position identity. All 322 focused tests and the
  Web typecheck passed afterward (exit 0); no second full Web run is needed for
  this isolated pure-key change.
- Keep PR #5060 draft and this plan active. Do not merge or run ReviewGPT.

## Signature and bounded-effect refinements

- Route rollover (rows 04/10) requires the caller's canonical series and current
  authority, hence the required setter context and computed state patch.
- Map preview (rows 04/15) adds the explicitly requested `from`/`to` query variant
  to BE0's parser and enforces Mapbox's documented 1280-pixel maximum.
- Picture collections admit at most 10,000 rows through a limit-plus-one read.
  Account deletion rejects an incomplete collection before purging, retires an
  admitted collection serially, then removes its rows. The earlier proposed
  100-picture continuation was removed to honor section 9. No background job,
  truncation recovery or automatic retry is added.

- Camera transport also limits JPEGs to 2 MiB to fit the existing 3 MiB sealed
  store boundary; the plan's 2048-pixel limit still applies.
