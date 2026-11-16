# Game Not for me: activities a player never wants suggested

Status: completed
Created: 2026-11-16
Updated: 2026-11-16

## Goal

A player can say once which activities they never want in a game (a tester
asked for no yoga, dance or swimming). Every idea Murph offers in game setup
then leaves those out, whoever sets the game up: the bundled idea bank on the
phone, the typed-words idea writer on the server (Responses + Decisions API),
and prizes and dares. The player can set it in the app (Settings, About you,
Not for me) or by texting Murph, who gets a private tool for it.

The owner approved the Paper mock (Game creation file, page "Not for me ·
Wojciech (new)") and these calls:

- Keep "hold an idea, Not for me" in setup as a second way to add one.
- Water that isn't swimming (surfing, kayaking, a beach day, a day on the
  water) is fine when someone skips swimming.
- Murph gets a tool to set the list for people who text it.

Priority from the owner: clean, simple, long-term maintainable, composable,
minimal complexity.

## Success criteria

- A player's list is stored once, on the server, and survives reinstall.
- The app's About you page shows "Not for me" with the current list and a
  checklist page that saves optimistically (no Save button, no waiting UI).
- With Wojciech's list set to swimming, yoga and dance, no setup idea for his
  side, no shared idea, and no prize or dare in a game with him is one of
  those (bank ideas and server-written ideas alike). Surfing and beach ideas
  still show.
- Texting Murph "no yoga, dance or swimming in my games" in a direct chat
  ticks the same list; the app shows it on the next home refresh.
- Old apps and the old runner keep working through the deploy in either
  order.

## Scope

- In scope:
  - `game_profile.not_for_me` column, one closed list of activity keys.
  - App API: write through the existing `PUT /me/profile`; read through
    home `me`, game `players[]` and history `people[]`; `POST /ideas` takes
    the list to respect.
  - Ideas writer: one brief line and one Decisions predicate per idea when a
    list is given.
  - Murph tool `murph.my_game_not_for_me` (read/set), direct chat only, on
    the existing private game tool port.
  - murph-ios: About you row, Not for me checklist (closed and open Duo),
    bank tagging in `scripts/game-ideas/build.mjs`, idea filtering, the
    long-press menu on idea chips, and the list on the ideas request.
- Out of scope:
  - Group-chat game setup by Murph (`read_game` does not carry the lists in
    v1). Noted as a follow-up for the owner.
  - Changing a task someone already put in an invite; the invitee can still
    negotiate it.
  - Free-text activities. The list is closed so the bank can be tagged
    offline and every check stays a fixed question.

## Design

### One closed list

`GAME_ACTIVITIES = walking, running, cycling, swimming, yoga, dance, pilates,
lifting, stretching, climbing, rowing, golf` (the 12 rows in the mock). The
key list lives with the other game constants shared by Web and the runner
(`packages/hosted-execution/src/game-tools.ts`), so the app API, the ideas
input and the Murph tool schema validate against one list. The words a model
reads for each key ("swimming, or time in a pool like water aerobics or a
water park; surfing, kayaking, paddleboarding and beach days are not") live
in `apps/web/src/lib/game/ideas/rules.ts`, which the phone's bank build
already mirrors.

Adding an activity later is a code change only: the column is `text[]`, and
readers drop keys they do not know.

### Storage

`game_profile.not_for_me text[] NOT NULL DEFAULT '{}'`. Additive, so old Web
code is unaffected. Not encrypted: it is a closed list of activity keys, not
free text, and other players' phones need it to filter ideas (the same
reason first names travel to co-players).

### App API (no new routes)

- Write: `PUT /me/profile` accepts `notForMe: string[]` (whole list, known
  keys, deduplicated). It reuses `setProfile`'s partial update, so it needs
  an existing game profile like every other profile field.
- Read: `home.me.notForMe`, `GamePlayerView.notForMe` and
  `GameHistoryPersonView.notForMe`, omitted when empty or when the person is
  hidden from the viewer (same rule as avatars). That covers both lists the
  setup screen picks people from (Play again and live games).
- `POST /ideas` takes optional `notForMe: string[]`: the phone sends the
  lists that apply to the side being asked for. The server does not look the
  lists up itself; the endpoint stays a pure function of its input, and the
  filter is a preference, not an authority boundary.

### Ideas writer

When `notForMe` is non-empty:

- The brief gets one line: never anything that is one of these activities.
- `gameIdeasCheck` adds one choice question per idea, `a{i}`: "Which activity
  is X?" over the 12 activities plus three catch-alls (water sports and the
  beach, other exercise, not one activity). An idea whose answer is a listed
  activity at 0.5 or more is dropped before the fit sort, the same way a
  failed `r{i}` is. With no list (absent or empty) both provider request
  bodies are byte-identical to today.
- The bank build asks the same question with the same choices, so the phone's
  tags and the live check agree. A probe of predicates ("Is X swimming?")
  was badly calibrated ("Run 30 min" scored 0.47 for running, "A day trip"
  0.91 for golf); the choice form put surfing, kayaking, a beach day and a day
  on the water outside swimming, and pools, water parks and water aerobics in
  it.

### Murph tool

New tool `murph.my_game_not_for_me`, `operation: read | set`, `activities`
(the whole list) on set. Direct chat only, authorized exactly like
`my_game_reminders` (the accepted direct-chat input's own wake and route), and
it writes through the same `setProfile` command as the app. Its availability
uses the same condition as the reminders tool.

A new action instead of new fields on `my_game_reminders`, because the
runner parses Web's tool responses with strict schemas: extra fields on the
reminders result would break an old runner the moment Web deploys first. A
new action is ignored by the old runner and refused by the old Web, so either
deploy order is safe.

### Phone

- `GameActivity` enum (key, title, SF Symbol) matching the server keys.
- About you gets an "In games" section with one row, "Not for me", showing
  the list ("Yoga, dance, swim") or "None". It pushes the checklist page.
  Ticks save optimistically through `PUT /me/profile`; a failure puts the
  tick back.
- The bank build asks the Decisions API, per idea and activity, the same
  phrase the server uses, and writes `activities: [key]` on tagged ideas
  (cached like every other answer). `GameIdeas` filters its pools by a
  `Set<GameActivity>`: a side's own task ideas skip that side's list; shared
  task ideas, prizes and dares skip both.
- Long-press on an idea chip that is tagged and is for you (your task or a
  shared one) shows a context menu with one item, "Not for me", which adds
  the activity to your list.
- The typed-words request sends the same list the bank filter used.

## Risks and mitigations

1. Risk: deploy skew between Web, the runner and the app.
   Mitigation: additive column and optional fields; a new tool action
   instead of changing a strict result; the phone treats missing fields as
   an empty list.
2. Risk: the model tags or drops too much ("10 stair laps" as swimming, a
   beach day as swimming).
   Mitigation: the swimming phrase names what is not swimming; spot-check
   the bank tags for each activity before committing the rebuilt bank, and a
   live writer eval with and without a list.
3. Risk: an idea pool runs thin after filtering (for example walking and
   running both skipped).
   Mitigation: filtering is a plain removal; `GameIdeasTests` gets a check
   that every category still has ideas with a three-activity list.

## Tasks

1. Backend (murph): constant, migration, profile write/read, player and
   history views, ideas input/brief/check, Murph tool through contract,
   runtime, Web handler and catalog, tests.
2. Phone (murph-ios): wire fields, `GameActivity`, About you row and
   checklist with Duo, bank tags and rebuilt `GameIdeas.json`, filtering,
   chip menu, ideas request, tests.
3. Verify: Web unit tests and typecheck, engine/runtime tests, a live writer
   eval with a list, iOS unit tests and simulator screenshots against Paper
   (closed and open Duo).
4. Ship: backend PR first (Web, then runner), then the iOS PR to TestFlight.

## ReviewGPT plan review (2026-11-16, `audit-packages/plan-game-not-for-me.md`)

1. P1, unbound contacts: accepted. A first game with a contact keeps the
   invite unbound so it never reveals who is a member, so that person's list
   is unknown, not empty. The promise is now "games you set up, and ones set
   up by people you've played"; the About you caption says so. No contact
   lookup.
2. P1, one exclusion set per target: accepted. Setup computes one set per
   part (theirs, mine, or the union for a shared task and the stakes) and
   uses it for the bank filter and the typed-words request; ideas Murph wrote
   under an older set are dropped, and a late answer with them (the existing
   generation guard). Rejected the `appliedNotForMe` acknowledgment: Web
   ships before the app, so the only gap is a Web rollback below this PR,
   which lets typed-words ideas ignore the list until it rolls forward while
   the bank stays filtered. Recorded as the rollback floor.
3. P2, one save owner: already the design. `GamePrototype.setNotForMe` is the
   one owner for the checklist and the chip menu: local state first, one save
   at a time with the latest whole list, no rollback of newer intent, and home
   doesn't overwrite while a save is out; the saved list replaces the cached
   home's. Omitted `notForMe` leaves the column alone and `[]` clears it.
   `GameProfileView` carries the list. Rejected preserving unknown keys on the
   phone: everyone updates through TestFlight (no old-build compatibility), and
   keys are added to the app and server together.
4. P2, duplicated game-action lists: accepted. One exported list of game tool
   actions from the contract drives request and response parsing and runtime
   identity forwarding; the per-action authority map stays as it is.

## Decisions

- Closed activity list (12 keys) over free text.
- Stored on `game_profile`, written through `setProfile`.
- Phone sends the applicable list to `/ideas`; the server does not look it up.
- One choice question per idea (bank and live check alike), not predicates.
- v1 covers you and people you've played; a first invite's person is unknown.
- New Murph tool action instead of extending `my_game_reminders`.
- Group-chat setup by Murph stays out of v1.

## Outcome (backend PR)

- Built as planned: `GAME_ACTIVITIES` and one `GAME_TOOL_ACTIONS` list in the
  contract (the request and response parsers and the route's identity
  forwarding now read it), `game_profile.not_for_me`, `PUT /me/profile`
  `notForMe`, home/profile/player/history reads, `/ideas` `notForMe` with one
  brief line and one `a{i}` choice question per idea, and
  `murph.my_game_not_for_me` (deferred, direct chat only, same gate as
  reminders).
- Reads return the stored list as written: the only writer validates and
  orders it. The writer's choice parsing checks names, values and ranges but
  does not require all 15 probabilities, so a provider that omits
  near-zero choices still filters instead of failing every request.
- Live writer eval with swimming, yoga and dance (seed 42): Talk 10 min,
  Stretch 5 min, Take 5 min to breathe, Meditate 5 min, Walk 15 min, Journal
  5 min, Read 10 pages (3.8 s). The live Codex journey read the list first,
  kept lifting, added the three and said surfing stays.
- First provider request bytes unchanged for direct and group (the tool is
  deferred).
- The phone part ships as a separate murph-ios PR after this one deploys.

## Verification

- Commands to run: focused Vitest for `apps/web/src/lib/game` (command,
  service profile, views, ideas writer), engine and runtime game tool tests,
  `pnpm typecheck`, the ideas live eval with a list, murph-ios unit tests and
  UI screenshots.
- Expected outcomes: all pass; the eval returns no swimming, yoga or dance
  ideas with the list; captured provider request bodies are unchanged with no
  list.
Completed: 2026-11-16
