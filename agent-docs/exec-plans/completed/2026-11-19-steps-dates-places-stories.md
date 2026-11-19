# Steps: dates, places with states, postcard stories, typo-proof Where to?

Status: completed
Created: 2026-11-19
Updated: 2026-11-19

## Goal

Ship the Nov 19 Paper page "Steps: dates, places, search" (owner: "lets get all this shipped"). Server half here (murph). The app half is murph-ios `feat/steps-line-places`.

1. Say when, not just how far. The Steps headline reads "141 mi in 48 days". The map's start says "Left Oct 3", a passed town says its day, the finish says "by Dec 14". Under the map, one line: "86 mi left to Washington, D.C.", then a running-total line chart.
2. Every place says its state. The places list and the map show "Newark, DE" / "Newark, Delaware" (outside the US and Canada: the country).
3. The postcard turns over. A tap on the walk drawer's postcard flips it to a short title and three plain facts about the town. Luna writes it once per place and it is kept for everyone.
4. Where to? stops saying "No route" while it is still looking (app). A typo gets fixed ("Showing Lisbon. You typed Lisbn."). A real miss names the place ("Can't find Grandma's house") instead of a 404 that the app shows as Try again.
5. App only: pinned pills, the walk drawer's full-width postcard with Send under it, "Walk somewhere else" at the end of the walk drawer, the Duo's right column of places, and the climb chart's landmark lines starting where you passed them.

## Success criteria

- Contract additions are optional and additive: build 118 keeps decoding every read.
- `route.startedOn`, `route.etaOn`, `route.daysText`, `route.remainingText`, `route.chart`, `towns[].at`, `towns[].region`, `towns[].regionCode` are correct for a first leg, a later leg (saved and older), a finished leg and a leg whose start is no longer known (tests).
- "in N days" counts the same days as the leg's miles: from its start day through today.
- One story row per place, shared. Concurrent first flips start one Luna call. A failed story retries on a later flip, at most 3 attempts. A member can only start stories for towns on their own current leg.
- A Mapbox miss with close spellings goes through one Decisions call. Luna can pick only a Mapbox candidate or none. A pick previews the route and says what was typed. None returns `notFound` naming the place, with no 404.
- Tests: route dates and words, region parsing (US, CA, elsewhere, no label), story claim/ready/failed/not-on-route, typo fix pick/none/Decisions failure, not-found wording.

## Scope

- In scope: murph Progress route view and contract, `mapbox.ts` geocode fallback, a story route and its store row, goals preview wording.
- Out of scope:
  - Re-geocoding stored towns. Regions come from the stored Mapbox label.
  - Changing how totals or routes count (the 365-day window stays as is; only the words follow it).
  - TestFlight. The app PR merges; upload waits on the owner's word.

## Design

### Route dates and words (`route-progress.ts`, `contract.ts`)

`routeView` gains `today`. New fields on `route`:

- `startedOn`: the leg's first day (see Decisions 3 and 4); null when it can't be known.
- `etaOn`: today plus the days `routeEta` already computes at the last 30 days' pace; null when finished or with no pace. `etaText` stays for build 118.
- `daysText`: "in 48 days" (today minus `startedOn`, plus one; "in 1 day"); null without a start day.
- `remainingText`: "86 mi left"; null when finished.
- `chart`: `{ unit: "mi" | "km", distance, points }`, the leg's own running total in the member's unit, from `startedOn`; null without a start day.
- `towns[].at`: how far along, in the chart's unit, for its plates.

### Regions (`route-progress.ts`)

The stored label is "Newark, Delaware, United States". Split on ", ". The country is the last part. For the United States and Canada, the region is the part before the country, and `regionCode` comes from a 64-entry table of state, DC and province names ("DE", "ON"). Elsewhere `region` is the country and `regionCode` is null. No label, or a one-part label: both null. Preview towns have no place, so they are null too.

### Postcard stories (`place-story.ts`, `GET /api/game/v1/progress/story?measure=&town=`)

- The route reads the member's own measure state, takes the current leg's town at `town`, and needs its Mapbox place. No place: 404. So a member can only start stories for towns on their own route, and the prompt only sees the public label.
- The key is `story:v1:<mapbox place id>` in `game_place_art` with kind `story`, after a migration widens the kind check. The bytes are the JSON `{title, facts[3]}`. The art route's key regex already refuses `story:` keys, so a story is never served as an image.
- Read: ready returns `{ state: 'ready', title, facts }`. Otherwise claim the row (the same claim as posters with story rules: max 3 attempts, a 12 s lease, retried a minute after a failure, outside the image allowance, inside a member allowance of 30 cold starts a day). A claim made in this request writes the story inline under an 8 s deadline (`gpt-6-luna`, Responses, strict JSON schema, `store: false`, effort none), then finishes the row and returns it. Someone else's live claim returns `{ state: 'making', typicalSeconds: 3 }`, and the app asks again. A failure returns `{ state: 'failed' }`, and the app's back says "Couldn't load this town's story".
- Output check: title 1 to 40 chars, three facts of 1 to 220 chars each, no em dashes (replaced with commas), no digits-only lines. If the check fails, the attempt is a `refused` failure.
- Prompt: the label only. It asks for a short title and three plain, well-known facts (history, what it's known for, where it sits), says nothing about the reader, and says to skip anything it is unsure of.

### Where to? (`mapbox.ts`, `routes.ts`, `contract.ts`)

- In the goals preview only, a geocode miss runs an autocomplete forward geocode (`autocomplete=true`, `limit=5`, not permanent, since nothing from it is stored). With no candidates, the place is not found. Otherwise, inside the member's fix allowance, one Decisions call asks a `choice` question over the candidates' qualified labels plus `none`, with a 4 s timeout. If the top choice is a candidate with probability at least 0.6, the permanent geocode runs on its qualified label and must return the same place (Decision 2). Anything else, including a Decisions error, means not found.
- The preview returns the fixed endpoints as qualified labels, plus `fixed: { typed, showing }`. Saving the preview then geocodes the qualified label with no Decisions call.
- `routeGoalPreview` adds `fixed` (the first fix, or null). `readRouteGoals` catches `PlaceNotFound` and returns `route: null, notFound: "<the place as typed>"`, with the same suggestions as an unmatched query. `setRouteGoal` keeps the 404, since the app only saves a previewed route.

## Risks

- A wrong typo pick: shown as "Showing X. You typed Y." before Make it my goal, so it is easy to spot and retype.
- Luna facts can be wrong. They stay plain and short, the prompt says to skip what it isn't sure of, and they are shared, so one bad story is visible to all. Fix: delete the row and it is written again on the next flip.
- `chart.points` grows the Steps read by one pair a day (at most 365). That is small next to `points`, which it mirrors.
- Old builds show a fixed place's preview under its full label in one accessibility string ("Map of London to Lisbon, Lisbon, Portugal"); before, that typo was a 404.

## Tasks

1. Contract fields and `routeView` (dates, words, regions, chart series) + tests.
2. Story store, route, Luna writer + tests.
3. Geocode typo fallback, not-found wording + tests.
4. Changelog entry, PR, CI, ReviewGPT round, merge. Then the app PR.

## Decisions

ReviewGPT plan review (mountain lane, 2026-11-19, `audit-packages/plan-steps-dates-places-stories.md`). All six findings accepted:

1. **Accepted.** `game_place_art_kind_check` allows only poster and map (`20261118230000_game_place_art/migration.sql`). Added a forward migration widening it to `story`. Stories have their own claim rules (12 s lease, retried after a minute, no image allowance), passed to the same `claimArt`/`finishArt`; image leases are unchanged. After a lost claim the row is read again, and a dead final attempt reads as failed once its lease ends.
2. **Accepted.** A fixed place keeps its identity. The Decisions pick is a Mapbox candidate (id, qualified label, point). The permanent lookup queries its qualified label, and the result must have the same `mapbox_id` (or land within 2 km when an id is missing); otherwise the fix is refused. The preview's `from`/`to` are the qualified label, so map and save geocode the same place with no Decisions call. A saved leg named from a qualified label takes the place's short name. Only the goals preview runs the fix. Town samples dedupe by place id, falling back to name.
3. **Accepted.** No sign-up origin. A first leg (position 0) starts on its series' first counted day, which already covers imported runs and the Steps 365-day window. `Progress.joinedOn` is untouched.
4. **Accepted.** New legs store `startedOn` (the setter's today) in the sealed state. Older legs: the first by position takes its first counted day; a later one takes the day the total crossed its start, else none. `startedOn` and `daysText` are nullable, and the app shows no "Left" date without one. The chart applies an earned finish on its day and carries the full distance forward. With no start day, there is no chart.
5. **Accepted.** Member allowances through `hostedAuthRateLimitStorage(...).consume`. Story cold starts: 30 a day (ready reads and polling are free; a denial claims nothing). Typo fixes: 30 a day, taken at the goals preview only when Mapbox has candidates.
6. **Accepted.** The preview-image path (`map?from&to`) resolves geometry only, with no reverse town lookups. Full previews and saves keep sampling towns.

Also kept from the review: preview misses return `notFound`, saves keep the 404, and provider failures stay 503. The integer day estimate feeds both `etaOn` and the old `etaText`.

## Verification

- `pnpm --dir apps/web typecheck:prepared`: clean.
- Every `apps/web/test/game-*` file: 2171 passed (Postgres cases skipped there, run below).
- New: `game-progress-route-dates` (dates, words, chart, regions), `game-progress-place-story` (story read/write/allowance/claim-matching reads, Decisions pick bar), `game-progress-story-route` (HTTP, Steps vault authority, query refusals), place-fix cases in `game-progress-mapbox` (one autocomplete lookup, identity check, saved label, no fixer on save, town dedupe, geometry-only preview map), fixed/notFound/503 preview in `game-progress-routes`, story keys refused by the art route.
- `game-progress-place-art-postgres` against a fresh local PostgreSQL 17 with every migration applied (the kind check reads poster, map, story): 8 passed, including one write for six concurrent first flips, story leases next to unchanged poster leases, and an abandoned last try reading as failed.
- ESLint on changed files: clean. `pnpm complexity:diff`: no hotspot above 20 (`routeView` 17).
Completed: 2026-11-19
