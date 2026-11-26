# Health wins: Home feed of friends' wins

Status: completed
Created: 2026-11-25
Updated: 2026-11-25

## Server completion and rollout handoff

This PR completes the phase 1 backend. The game Home flag, authenticated feed
and composer API, win selection, encrypted media, interactions, access checks
and account deletion are implemented. The rollout allowlist defaults to empty.
The [product spec](../../product-specs/health-wins.md) and
[architecture](../../../ARCHITECTURE.md#health-wins) describe the implemented
contract and supersede the initial design notes below.

The native Home, composer, profile and Try it flows continue in `murph-ios`.
Product UX is on hold for the native client and its TestFlight walkthrough.
The timed activity recorder and GPS recording continue in phases 2 and 3.
Their plan is drafted outside this repository.

## Goal

Home becomes a feed of health wins shared between game partners ("Strava for
longevity"). Murph prepares wins from the member's own data, the member picks
one or more cards, adds a line and an optional photo, and posts. Friends see
it on Home, can cheer (heart), comment (everyone or just the poster), open a
profile, and tap "Try it" to start the same thing alone (Murph experiment over
iMessage) or with friends (a game). Later phases add a Strava-like recorder for
heart-rate activities (sauna etc., with a timer) and GPS runs and walks.

Design source of truth: Paper file "Murph · Health wins home (Nov 25)", page
"SHIP · Health wins" (Home/posts/profile, Make a post, Record an activity,
Every card). Owner calls are in the Decisions section.

## Success criteria

- Phase 1 on TestFlight behind a per-member server flag, owner first:
  - Home feed: game faces row on top (tap opens today's game page), then posts
    from game partners newest first, cheer/comment/send icons, no counts.
  - Composer: + menu (New post / Start an activity / New challenge); pick screen
    with Murph-made cards from the member's own data, filter pills (All, Sleep,
    Fitness, Heart, Labs, Challenges, Experiments), numbered multi-pick, pencil
    "Change card" (fixed choices), words screen with caption tips and photo +,
    Post; posting/failed/edit/delete states.
  - Opened post (Instagram-like), comments sheet with Everyone / Just <poster>,
    profile sheet (posts + numbers the member already shares), Try it drawer.
  - Cheer and comment pushes.
- Wins engine produces only honest wins from real data (see Wins engine) with
  unit tests on synthetic fixtures for every detector, data-quality rule and
  audit finding below.
- Every number shown on a card comes from the engine; no model writes numbers.
- Privacy: only current game partners (minus blocks and hides) can read a
  member's posts; all health content and captions sealed; account deletion
  removes posts, comments, cheers and media.
- Phase 2 and 3 have their own plans before implementation.

## Scope

- In scope (phase 1): server tables, routes, wins engine (wearables, labs,
  experiments, game progress), Decisions API ranking with deterministic
  fallback, iOS feed/composer/post/comments/profile/try-it, flags, pushes,
  docs (ARCHITECTURE.md section, product spec).
- Out of scope (phase 1): the activity recorder (phase 2), GPS run/walk
  (phase 3), global/everyone audience, voice comments (fast follow, reuses the
  reply audio pipeline), Android, web UI.

## Constraints

- Technical:
  - Invariants 420-438: classify every new column; health values, captions,
    comments and card specs sealed (`sealGameText` scope or a new
    `health-post` scope via secure-box); photos for health posts go to the
    sealed progress media store, not the Cloudflare Images exception.
  - Invariants 522: bounded reads (cohort cap, page size 20), batch crypto,
    no external calls (KMS, Decisions API, vault replica) inside transactions.
  - Auth: `requireGameMemberAuth`; health reads also
    `assertBrowserVaultMemberAuthority`.
  - Vault reads through `readCompanionHealthSeries` and the browser replica
    client; labs and experiments need a new read through the same replica.
  - Deploy skew: new app on old server hides the feed (no flag); old app on
    new server is unchanged (Home stays the game page).
- Product: owner rules for cards (memory: number + measure titles, real values
  in chart pills, no add-on lines, no dots on long ranges, app tooltip shape
  two lines, RHR wording, "on foot" for Apple distance, app landmark art,
  app streak art). Plain copy. Fewest controls per screen.

## Decisions (owner, Nov 25)

- Audience = game partners: anyone you have played a live or settled Murph
  game with sees your posts automatically; you can remove any one person.
  No friend requests. Removing is softer than a block: posts stop flowing both
  ways; games and chats are untouched.
- Planned rollout in three phases: 1) feed/posts/cards/cheers/comments incl.
  private/profile/Try it; 2) record an activity on the heart-rate recorder with
  a timer, Strava-like; 3) Strava-like GPS run/walk with route, distance,
  pace, splits, elevation, HR.
- Comments: each comment is Everyone (default) or Just <poster>.
- Try it: one pill -> drawer: By yourself (opens Messages with Murph, prefilled
  experiment ask) or With friends (game setup prefilled with the task).
- Counts are never shown (cheers, comments).
- No Murph comments in the feed.

## Architecture

### Data (new, `apps/web/prisma/schema.prisma`)

- `health_post`: id, author_member_id, created_at, deleted_at, version,
  caption_encrypted, cards_encrypted (array of card specs, see below),
  photo attachments via a health attachment record (see ReviewGPT 2); one sealed
  content envelope per card (see ReviewGPT 3); no card images.
  Index (author_member_id, created_at desc).
- `health_post_cheer`: (post_id, member_id) PK, created_at. Social metadata,
  no health content; plaintext ids are classified as such.
- `health_post_comment`: id, post_id, author_member_id, visibility
  (everyone|poster), body_encrypted, created_at, deleted_at.
  Index (post_id, created_at).
- `health_feed_hide`: (member_id, hidden_member_id) PK, created_at. Read in both
  directions, like blocks, capped like blocks (500).
- `health_win_set`: member_id, day (member-local date), source_revision,
  candidates_encrypted, created_at. One row per member per day; recomputed
  when the vault revision changes or on pull-to-refresh, at most hourly.

### Audience and feed read

- Audience(viewer) = `friendCohortIds(viewer)` minus `health_feed_hide` in
  both directions (blocks are already removed by the cohort helper).
- Feed page = posts where author in audience or author = viewer, deleted_at
  null, created_at < cursor, newest first, 20 per page; cohort read is bounded
  (cohort cap, then one indexed `IN` query).
- After decrypting, re-check the cohort and hides (Everyone-board pattern) so a
  removal during the read wins.
- Comment visibility: poster sees all; others see Everyone comments plus their
  own private ones.

### Wins engine (`apps/web/src/lib/health-wins/`)

Deterministic detectors over typed inputs; Decisions API only ranks and answers
fixed yes/no checks. Full rules in the build notes, summarized:

- Inputs: wearable daily series (one provider per metric with fixed priority;
  never sum providers), workouts/sessions, labs (test events + clinical
  observations from the vault replica), experiments (bank outcomes), game
  progress measures (totals, landmarks, streak days).
- Data-quality gate: hard bounds per metric; MAD outlier drop only for
  physiological metrics (sleep, RHR, HRV); nights under 3 h are no data;
  month needs >= 15 days (month to date >= 14, labeled).
- Detectors: trend_change (current month vs median of prior 3 full months),
  threshold_count, streak, best_month, personal_record (only where better is
  clear; no "most sleep"), cumulative (+ route/landmark equivalence),
  percentile (only from sourced norms: existing `age-norms.json`, new
  `lab-norms.json`; device-aware RHR norm like the app), lab_range,
  lab_change (latest vs median of >= 2 prior draws; fasting-aware),
  game_climb, game_streak, experiment_result (honest; flags overlap and low
  adherence), sessions.
- Ranking: deterministic score (effect vs noise, recency, rarity, category
  balance); optional one Decisions API call with fixed choices to pick the top
  N and to answer "is this a win a friend would cheer" per candidate. Timeout
  or error falls back to the deterministic order.
- Sensitive filter: never medications, genetics, conditions, flagged labs,
  weight (unless opted in later).
- Output: card specs grouped by filter, best first, stored in
  `health_win_set` so the pick screen is instant and stable within a day.

### Card spec (server -> app)

```
{ id, kind, filter, title: { number, measure }, subtitle, source_note,
  chart: { type, ... typed fields per type }, change_options: [..fixed..],
  caption_tips: [..] }
```

Chart types (app draws natively, SwiftUI Canvas, reusing app parts):
trend (line + soft fill + start/end pills), bars (nights with pass color),
monthly_bars, record (soft line + dot + date pill), percentile (GameAgeHill),
lab_range, two_bars, skyline (landmark art from ProgressLandmarks), week_dots
(GameStreakDots + GameFlame), sessions, map (server route map image),
heart_rate (GameHeartRateCard). Unknown chart types render title + subtitle + an update note (ReviewGPT 3).

"Change card" uses fixed options produced with the card (e.g. Show the whole
year, Start in August, Hours not minutes, Hide my numbers) that re-run the
detector with different parameters. No free-form model rewrite of numbers.

### Routes (`/api/game/v1/health/...`)

- `GET feed?cursor=` -> posts page + games row stays on existing Home payload.
- `GET wins` -> today's candidates (computes if stale; bounded time budget,
  returns last good set on timeout).
- `POST wins/{id}/change` -> re-derived card for one fixed option.
- `POST posts` (cards by candidate id + option, caption, photo keys, rendered
  card image keys; idempotency key) ; `PATCH posts/{id}` (caption, cards);
  `DELETE posts/{id}`.
- `PUT/DELETE posts/{id}/cheer`; `GET/POST posts/{id}/comments`;
  `DELETE comments/{id}`.
- `GET people/{memberId}/profile` (posts + numbers the member already shares
  through existing friend sharing consent; nothing new is exposed).
- `PUT/DELETE hides/{memberId}`.
- Flag: `health_feed` per member (env allowlist first, then percentage).

### Pushes

Cheer and comment use the reply-notification pattern: claim a `game_event`
row in the write transaction, send one best-effort push after commit. Cheers
coalesce per post per hour. Private comments push only the poster.

### iOS (murph-ios)

New Home behind the server flag: faces row (existing games) + feed. New
screens: composer (pick with filter pills and numbered picks, change sheet,
words with caption tips and photo +), opened post, comments sheet, profile
sheet, Try it drawer, + menu. Card views per chart type in a new
`MC/Game/HealthWins/` folder, gallery entries for every card type, `--proto`
fixtures for every screen state (empty feed, first post, posting, failed,
deleted post, hidden person, no wearable, nothing new to share, experiment
running).

## Risks and mitigations

1. Overclaiming wins from sparse or inconsistent observations.
   Mitigation: robust baselines, quality gate, sourced norms only, tests per
   rule, and a separate client canary before rollout.
2. Leaking health data to the wrong person.
   Mitigation: audience computed at read time with post-decrypt re-check,
   sealed content, route tests for removed/blocked/never-partners viewers.
3. Vault replica latency or failure making the composer slow.
   Mitigation: daily cached set, time budget, last-good fallback, empty-state
   copy ("Nothing new to share yet") with Post a photo / Start an activity.
4. Home replacement regressing games.
   Mitigation: flag per member; faces row opens the exact existing game page;
   game page untouched; UI tests for both flag states.
5. Deploy skew between app builds and server.
   Mitigation: additive routes and an optional Home flag. New clients can show
   the title and subtitle of an unfamiliar chart and prompt for an update.

## Regression cases

The engine tests use synthetic observations for these rules.

1. Use a multi-month baseline for a resting heart rate trend.
2. Derive sleep changes from the measured interval and the displayed units.
3. Choose one provider per metric before aggregating daily activity.
4. Keep valid activity peaks when filtering physiological outliers.
5. Limit records to metrics with a supported direction of improvement.
6. Exclude incomplete sleep observations from qualifying streaks.
7. Match aerobic fitness comparisons to the supported reference group.
8. Match heart rate comparisons to the measurement method.
9. Use the reporting lab's range when a population comparison is unavailable.
10. Compare like lab draws under the analyte's fasting requirements.
11. Use association language for overlapping interventions.
12. Require repeated evidence before suggesting a lab change.

## Tasks

1. ReviewGPT this plan (architecture); record outcomes below.
2. Backend lane (Codex): schema + migration, crypto scopes, audience, routes,
   pushes, flag, deletion cascade, tests.
3. Wins engine lane: detectors, quality gate, norms (age + lab), Decisions API
   ranking, card spec builder, tests with synthetic fixtures for each finding.
4. iOS lane (me + subagents): card views, feed, composer, post, comments,
   profile, try it, + menu, fixtures, gallery, UI tests.
5. Client rollout: review suggested cards and complete the TestFlight walkthrough
   before widening the allowlist.
6. Docs: ARCHITECTURE.md section, product spec, changelog.
7. Phase 2 and phase 3 plans.

## Verification

- Web: focused vitest for health-wins lib and routes, `pnpm --dir apps/web
  typecheck`, prisma migration check, invariants/docs checks.
- iOS: unit tests for card layout/data mapping, UI tests via `--proto`
  fixtures for every state, gallery screenshots compared to the Paper SHIP page.
- Owner canary on TestFlight with real data before widening the flag.

## ReviewGPT outcomes

Round 1 (architecture, mountain lane, Nov 25): 10 findings, all accepted.

1. P1 accepted: one shared read boundary. Post eligibility = viewer auth + author
   eligibility (incl. the author's current health consent/authority, rechecked
   after decryption) + partner relation + blocks + hides + post liveness. Comment
   eligibility = parent-post access + visibility + viewer<->commenter block. JSON,
   media and delayed pushes use the same decisions. Profile numbers compose
   `readPairBoard` (board.ts) instead of a new sharing resolver. Product rule
   (owner's product lead): a hide behaves like a block inside the health surface
   only, both directions, posts and comments; games and chats are untouched.
   Members can always delete their own content after consent withdrawal.
2. P1 accepted: media ownership reuses the Progress register -> upload ->
   publish -> retire -> purge lifecycle (pics.ts, share-cleanup.ts) with a small
   health attachment record; account deletion invokes it before cascades. Deploy
   the cleanup-aware server first; it becomes the rollback floor.
3. P1 accepted, simplified: drop client-rendered fallback card images entirely.
   Each post stores one sealed content envelope per card (stable id, immutable
   server-derived spec revision). Unknown chart types render title + subtitle +
   "Update Murph to see this card"; title/subtitle are plain fields every feed
   client decodes. "Hide my numbers" removes values from the spec, chart data and
   tooltips. Edits require expectedVersion (compare-and-swap).
4. P1 accepted: GET wins returns an opaque set revision; POST requires it with
   candidate id + option; a replaced set returns a conflict, never a silent
   substitution. The accepted spec is frozen in the post. Freshness covers the
   replica revision, game inputs (entries, measures, awards) and detector
   version; optimistic publish so a slow computation can't overwrite a newer set.
5. P1 accepted: wins select a consistent provider/method over retained rows
   before collapsing to one value per day; Numbers stays unchanged. Percentiles
   call existing heartRateWindowSource/rankAge (norms.ts); lab norms join the same
   ranking path.
6. P1 accepted: extend the browser lab projection additively (producer, parser,
   consumer) with fasting state, draw identity and parent exclusion status; old
   replicas yield unknown -> affected claims omitted. Consume labResults.list().
7. P2 accepted: one request-scoped replica load (decodeReadyBrowserVaultSession
   with the union of needed shards/buckets) feeding pure wearable, lab and
   experiment adapters; experiment cards use canonical outcomes (no recompute),
   keep overlap/adherence caveats; per-source failure is not fatal, authority loss is.
8. P2 accepted: game wins are adapters over existing Progress calculations
   (gameDays, gameSeries/entryContribution, roundTotals, ladderRungs,
   mergeVaultRuns); never call readProgress view (it can call Mapbox/settle awards).
9. P2 accepted: client-generated post.id / comment.id with actor/target replay
   checks and tombstoned ids; expectedVersion on edits; notification claims live
   on the post/comment rows (no GameEvent, which requires a game); cheer
   coalescing via an atomic hourly claim on the post; delivery via deliverGamePush
   with a health-authority callback.
10. P2 accepted: feed eligibility expressed relationally (shared-game existence
    predicate + blocks + hides) with no cohort cap; keyset cursor on
    (created_at, id); limit before decrypt; recheck only page authors; comments
    paged; indexes for feed order and reverse hide lookup; check the query plan.
Completed: 2026-11-25
