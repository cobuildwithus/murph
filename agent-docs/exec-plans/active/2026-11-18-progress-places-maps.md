# Progress: posters per place, painted maps, first route, Totals running, one-tap medals

Status: active
Created: 2026-11-18
Updated: 2026-11-18 (ReviewGPT outcomes recorded)

## Goal

Ship the Nov 18 Progress review that the owner approved ("start implementing all of this"):

1. The Steps page opens on your route's miles, and the running-total chart is gone (app).
2. The first route fits you. Your US/CA area code or country calling code picks the region. Your 30-day step average picks a route you would finish in 2 to 3 months, aiming for 12 weeks (server).
3. Totals shows Steps, then Running. Running counts game run check-ins plus vault runs (from chat or a watch), taking the larger of the two each day. There is no separate walking distance and no biking (server + app).
4. Map labels: the start's name moves off the line, its dot sits inside the map, and the remaining distance reads "416 mi to go" (server text + app).
5. A poster for every place on the route. Each place's picture is made once and reused by everyone. The walk drawer leads with the poster of the last place you passed. Tapping a place opens its poster with Send in Messages and Share (server + app).
6. Medal pictures take one tap. Only the first picture asks for a photo. The loader counts up to 100% on a timer, because OpenAI reports no progress (app, plus one server field).
7. Painted maps. Mapbox satellite imagery of the route is repainted by gpt-image-2.6-flare in the chosen look (E1: bright gouache, a few clouds) and stored for good. Mapbox granted the owner permission to store these. Our true route line is drawn over the painting, and the app draws the pins and names. While a painting is being made, the current map shows with a timed "Painting the map" pill.

## Success criteria

- A Steps leg whose painting is ready serves the painted map, with the walked and remaining line drawn at the same pixels as today's map. Town and here positions are unchanged, so build 117 keeps lining up its labels.
- Each place (town sample or destination) has at most one poster row, shared across members. Concurrent readers start one generation at most. A stuck or failed row is retried within bounds.
- New Steps members on a US/CA number or a mapped country code get a regional route sized to 56-91 days at their pace. Everyone else keeps the time-zone table.
- Totals Running equals, per day, max(game run meters, vault run meters). Vault-only runners see Running.
- Medal "Put me there" with a saved photo starts generating without a photo sheet. The loader reaches 100 only when the picture is ready.
- Tests cover: art claim and re-claim, the line composite geometry, route pick by region and pace, run merge with dedupe, and the poster/map contract fields.

## Scope

- In scope: murph server (Progress map, route, health and Totals reads, new shared art table, prompts) and murph-ios Progress UI (Steps page, walk drawer, place share drawer, map pins and pill, Totals pills, medal one tap and timed loader).
- Out of scope:
  - Biking.
  - Re-uploading the hand-managed Mapbox style.
  - Changing routes for members who already have a leg.
  - A TestFlight upload. The owner hold ("dont upload new build yet") stands until the owner says otherwise.

## Constraints

- Technical constraints:
  - Keep the Mapbox token server-side. Nothing in the generated art is personal: prompts carry place names and coordinates only, never a member.
  - The member's phone number is read only to derive a region code, then dropped. It is never logged or stored with the route.
  - External calls (Mapbox, OpenAI) stay outside DB transactions. Generation runs in `after()` under a fixed deadline, like the medal picture.
  - The contract change is additive: new optional fields. Build 117 must keep decoding.
- Product/process constraints:
  - Copy: no em dashes, no "about" before numbers, no "generate".
  - The look is E1. The prompt describes the style and never names an artist.
  - Synthetic names in tests (Ava, Leo, Sam).

## Design

### Shared art store (posters and painted maps)

One new table, `game_place_art`, with no member column:

- `key` (text, PK). Posters use `poster:v1:<sha256(lowercased name | lon,lat rounded to 0.05°)>`. Maps use `map:v1:<sha256(polyline | size | style version)>`.
- `kind` ('poster' | 'map'), `status` ('making' | 'ready' | 'failed'), `bytes` (bytea, null until ready), `created_at`, `ready_at`, `failure_code`, `attempts` (int).

This is non-personal place art, so it is not sealed per member. The rows stay small and few:

- A bank route has 8 town samples plus a destination, and 2 map sizes. Each image is a 200 to 400 KB JPEG or PNG.
- Postgres bytea avoids a new Worker route, R2 binding and deploy skew. If the count grows past a few thousand rows, move the bytes to R2.

The lifecycle:

- **Claim:** `INSERT ... ON CONFLICT DO NOTHING` with status 'making'. Re-claim a row with `UPDATE ... WHERE key = $1 AND ((status = 'making' AND created_at < now() - deadline) OR (status = 'failed' AND attempts < 3 AND created_at < now() - 1 hour))`, bumping `attempts` and `created_at`. Only the claimant generates, in `after()`.
- **Global budget:** at most 150 claims per UTC day, counted from rows created today. Over budget, the claim is skipped and the readers keep their fallbacks.
- **Serve:** `GET /api/game/v1/progress/art/[key]`, member-authenticated. It returns the bytes with `Cache-Control: private, max-age=31536000, immutable`, which is safe because the key is versioned.

### Posters per place

- **Places:** the leg's `towns`, plus the destination `to`. Each town's point comes from `cutPolyline(points, atM / distanceM)`, so existing legs need no migration.
- **When posters are made:** the Steps route read ensures art for the last passed place and the next unpassed place. That is "made when the first person passes the place before it". The finish place is ensured when you pass the last town.
- **Prompt input:**
  - At generation time, one Mapbox reverse geocode (`permanent=true`) of the point gives `place_formatted`, for example "Del Mar, California, United States".
  - The prompt is the scenery-only prompt from the review mocks: realistic, flat screen-print look, five-color palette, plain coral sky band at the top, plain navy band at the bottom, no text.
  - The output is 1024x1536 at quality medium, stored as JPEG q85.
- **Contract:** `towns[].poster` and `finishPoster` are each `{ state: 'ready', path }`, `{ state: 'making', startedAt, typicalSeconds }` or `null`. Each town also gets `stepsText`, the steps total on the day it was passed. The app draws all type over the poster.

### Painted maps

- **Framing:** unchanged. It stays the whole leg's `routeBbox` at `MAP_SIZES.card` (708x405) and `MAP_SIZES.drawer` (708x640). That keeps every town and here position the server already returns.
- **Base:** one Mapbox static request to `mapbox/satellite-v9` with no overlays and `attribution=false&logo=false`, covering the bbox expanded vertically (in Mercator) to the edit canvas's aspect:
  - The card uses 768x512@2x for a 1536x1024 canvas.
  - The drawer uses 512x512@2x for a 1024x1024 canvas.
- **Paint:** `images.edits` with `gpt-image-2.6-flare`, quality high, using the E1 prompt (keep geography exactly, bright gouache, a few small clouds over the hills, coast clear of clouds, no text, roads, towns or route).
- **Store:** crop the canvas back to the bbox and resize it to the map size with sharp. Store it as PNG.
- **Coast check:** compare sea masks between the satellite base and the painting in a band around the coast, ignoring white cloud pixels. If the median shift is over 3 px, the attempt fails and is retried later.
- **Serve:** `GET /progress/map` composites the route line onto the painting per request with a sharp SVG overlay: remaining `#CDBEA7`, walked `#5A6E32`, a thin white halo, and the same projection as `townPosition`. If no painting is ready, it falls back to today's `renderRouteMap`.
- **Contract:** `route.mapArt` is `{ state: 'ready' }` or `{ state: 'making', startedAt, typicalSeconds }`. The app shows the timed pill and refetches the map when the time runs out. The map URL is unchanged.

### First route by region and pace

- **Region:**
  - US/CA: `gameAreaCode(identity)` maps through an area-code-to-region table.
  - Otherwise, the E.164 country calling code maps to a region.
  - The fallback is today's `routes-tz.json`.
- **Pace:** the 30-day mean of daily steps from the health metrics `healthJourneys` already receives, divided by 2000 steps per mile. The target is 84 days. Among the region's candidates, pick the one whose days-at-pace is nearest 84 within 56 to 91, else the nearest overall.
- **Candidates:** a new `bank/routes-region.json`. Each region lists 3 to 6 checked city-to-city road routes of different lengths, each with `from`, `to` and an approximate `km`. `resolveRoute` still produces the real geometry and distance at assignment.
- **Scope:** this runs only when a Steps leg is first created. Existing legs never change.

### Totals: Steps, then Running

- **Vault runs:**
  - `activity_session` events with activityType run or running are already projected into the browser vault replica, with activityKind and `training.distanceKm`.
  - The Totals health read opens the same core shard that Steps uses and sums meters per day for run sessions.
- **Merge:** the Running measure (`run.meters`) shows, per day, max(game run meters, vault run meters). A vault-only runner gets a Running measure built from vault days.
- **App:** Totals shows All, Steps, Running, then exercises. The Walk pill no longer shows on Totals, but walk check-ins still count in games.

### Medal one tap and timed loaders

- **App:** with `presentation.state == 'available'`, Put me there calls start directly. Only `needs_photo` opens the photo picker, and Settings › Pictures of you changes the photo.
- **Server:** the `generating` presentation gains `typicalSeconds` (a server constant tuned from recent successes; start at 55). The app's ring is `min(0.95, elapsed / typicalSeconds)` and jumps to 100 on ready. The poster and map 'making' states use the same field.

### Map labels

- The server's `toGo` text for the route becomes "416 mi to go", using metric when units are metric.
- The app places the start label beside its dot, off the line, and clamps the dot inside the map.

## Risks and mitigations

1. Risk: OpenAI cost runaway from many typed routes.
   Mitigation: the global daily claim budget, a max of 3 attempts per key, and shared keys across members.
2. Risk: the painting drifts from the true coast, so the line runs over the sea.
   Mitigation: the coast check rejects a drifting painting. The line always comes from real geometry.
3. Risk: concurrent readers double-generate.
   Mitigation: a single-row claim with PK conflict, and a conditional re-claim.
4. Risk: deploy skew with build 117.
   Mitigation: additive optional fields, the same map URL and image size, and positions unchanged.
5. Risk: the phone number leaks into logs or prompts.
   Mitigation: only the derived region id leaves the identity read. Prompts contain places only.
6. Risk: vault runs double-count with game run check-ins on the same day.
   Mitigation: the per-day max, not a sum.
7. Risk: DB growth from bytea.
   Mitigation: bounded by the budget. Measure after a week, and move to R2 if needed.

## Tasks

1. murph PR A (art):
   - Prisma migration for `game_place_art`.
   - `place-art.ts` (claim, budget, serve, generation with deadline).
   - Poster prompt and generation.
   - Painted map base, paint, coast check and store.
   - Line composite in the map route, with the fallback.
   - The art GET route.
   - Contract fields `towns[].poster`, `finishPoster`, `towns[].stepsText`, `mapArt`, `typicalSeconds`.
   - "mi to go" text.
   - Tests.
2. murph PR B (first route): `routes-region.json` plus area-code and country tables, a pace pick in `healthJourneys`, the identity read, and tests.
3. murph PR C (running): vault run extraction from the replica core shard, a per-day max merge into `run.meters`, and tests.
4. murph-ios PR D:
   - Steps page leads with the route and drops the cumulative chart.
   - Map pins with place pictures, labels and the painting pill.
   - Walk drawer with the poster and its rows, and the place share drawer.
   - Totals pills (Steps, then Running, no Walk).
   - Medal one tap and the timed ring.
   - Scenario fixtures and screenshots.
5. Deploy order: the server PRs (A, B, C) merge and deploy first, then iOS merges. No TestFlight without the owner.

## Decisions

- The map framing stays the whole leg (today's bbox), not a sliding stretch, so the cache is one painting per route and size. The review mocks showed a zoomed stretch to judge the look.
- Postgres bytea over R2 for v1 (smallest change, no Worker skew).
- The loading base is today's custom-style Mapbox map with the timed pill. The mock's pale blue sea would need the hand-managed style re-uploaded.

## Verification

- Commands to run: `pnpm --filter web test -- game-progress`, `pnpm typecheck`, and iOS unit tests plus GameScreens scenario captures for the new states.
- Expected outcomes:
  - All tests pass.
  - A real painted map for a bank route lines up with town positions in a screenshot.
  - A second reader reuses the same art row.

## ReviewGPT plan review (2026-11-18, mountain lane)

Response: `audit-packages/plan-progress-places-maps.md`. Outcomes:

1. **Running distance is not in the replica for plain runs. Accepted.** `projectBrowserTrainingSession` drops generic device and unstructured manual runs (its tests say so), and the 183-day training window is the wrong history. Change: the replica producer adds a core-shard `runDays` rollup (`[{ date, km }]`, last 365 days), built from canonical run activity sessions after the existing mirrored-workout reconciliation and before provenance is stripped. Distance-only and manual runs count. Readers treat a missing field as "not provided", never as zero. This needs a runner (producer) deploy after Web.
2. **Compose `run.meters` once. Accepted, with a different read path.** One composition step merges game days with vault run days (per-day max), and every own-member consumer (Totals, map, goal read, goal set) reads the composed series. Friends keep game-only Running. The vault days are not read with a fresh replica session on each Totals open: that is a control-plane session per read. The background health settlement, which already opens the replica after each Progress read, saves them into the sealed `run.meters` state (`vaultRuns`). A failed or old replica leaves the saved days unchanged. They merge only while the member has health authority, and a new run award whose input included vault days is stored with `data.health = true`, so the existing visibility filter treats it as health.
3. **Art claim, retries and budget. Accepted.** The daily allowance is its own row (`game_place_art_budget(day, attempts)`), consumed by a conditional upsert in the same transaction as the claim. Every attempt counts, including retries. The 3-attempt cap applies to the stale-making and failed re-claims alike. The claim returns its attempt number, and completion or failure updates require `attempts = n AND status = 'making'`. Ready bytes never change.
4. **Shared art must come from public inputs. Accepted.** Poster identity and prompts come from a place-level reverse geocode (`types=place`) of the point. The key is Mapbox's place id, so a town and a destination that are the same place share one poster, and a typed street address never enters a key or prompt. Painted maps are made only for bank routes or legs of at least 50 km, where the frame is regional scenery. Shorter typed legs keep today's map. The stored painting holds no line, pin or name; the line is composited per request.
5. **Readiness per map size. Accepted.** `route.mapArt` describes the card picture and `route.drawerMapArt` the drawer one, each `{ state: 'making', startedAt, expiresAt, typicalSeconds }` or `null` (ready, failed, skipped and absent all mean "show the map you got"). The app animates on `typicalSeconds` and refreshes the map when it ends or at `expiresAt`.
6. **Regional table and pace. Partly accepted.** Pace now comes from the settled Steps days (the window ends at the last observed day, not the profile's today) and needs at least 7 observed days in the last 30; with fewer, the default 3 miles a day applies. The 56-91 day target is a best effort: the nearest candidate wins, and the real road distance from `resolveRoute` can differ from the table's `km`. **Rejected:** moving the regional pairs into `BANK`. BANK holds curated landmark routes with checked sources that the picker lists. A regional pair is a plain city-to-city road route resolved exactly like a typed goal, and its `km` only sizes the pick.

Other notes taken: art generation is admitted at the Steps presentation read (in `after()`, one absolute deadline, route `maxDuration = 300`), never inside the health settlement batch. The new route text is per town (`aheadText`), additive.

## PR A build notes (2026-11-18)

Shipped as written, except:

- **Stored format.** Posters are JPEG q85 and paintings JPEG q88, not PNG. The line is composited per request either way, and JPEG is a quarter of the size.
- **Coast check.** The check is the share of pixels in a band about 13 px either side of the photo's coastline whose sea or land matches, ignoring white cloud, and it must be at least 0.88. It replaces the median shift. Calibrated on the real E1 paintings: 0.93 to 0.96 for good paintings, 0.79 to 0.80 for a 20 px shift, 0.85 for a 15 px shift, and 0.47 for a mirrored coast. The photo's deep ocean is near black, (5, 10, 16), so a dark pixel leaning blue counts as sea; before that, San Diego to San Francisco's card scored 0.80 three times over a good painting, because open ocean read as land. Whole-sea overlap could not tell a 20 px shift from a good painting, so it was dropped. A frame with no coast passes.
- **Finish poster.** There is no separate `finishPoster`. The 8th town sample is the endpoint, so the last town's `poster` is the destination's.
- **Map readiness.** `mapArt` and `drawerMapArt` are `{ state: 'ready' }`, `making` or `null`. Review outcome 5 dropped `ready`, but the app draws its names in a light style over a painting and refetches the map when it turns ready, so it needs to know. `ready` carries no path: `map` serves the painting.
- **Time left.** Routes gain `etaText` ("10 weeks", "9 days"): the rest of the leg at the last 30 days' pace, or fewer days since the first. It is null with under 7 days of history, no pace, or a finished leg. The approved route row reads "416 mi to go · 10 weeks".
- **Every passed place gets its poster.** After the card map, the last passed and next posters and the drawer map, the Steps read queues the earlier passed places, newest first. Two pieces start per read, inside the daily budget, so a member who passed several towns before this shipped fills them in over a few opens. The walk drawer shows each passed place's picture on its row.
- **Scope of admission.** Only the Steps health read starts art. The other measures' routes (Totals) don't report or start art.
- **Older legs.** The first Steps read after deploy looks up each town's public place once, after the response. A town with no place stores `place: null`, so it is never looked up again.
- **Serving.** `GET /progress/art/:key` answers with `private, max-age=31536000, immutable`; keys are versioned and the bytes never change.
- **Medal loader.** `typicalSeconds` is the constant 55. The share row has no ready time to tune it from.
- **Live proof.** Monterey to Big Sur (via `resolveRoute`, real Mapbox and gpt-image-2.6-flare): the card painting passed the coast check, and the line sits on the painted coast. The Monterey poster kept the plain coral and navy bands. Both came back in 10 s.
