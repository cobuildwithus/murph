# App Review server fixes: open the game, keep the demo game fresh, drop the speech excuse wording

Status: active
Created: 2026-11-12
Updated: 2026-11-12

## Goal

Three server-side fixes before the 1v1 game goes to App Store review:

1. The game is open to every signed-in member while `MURPH_GAME_ENABLED` is
   on. The member allowlist and everything that only served it are gone.
2. The App Review account always finds a live seeded game with the opponent's
   post waiting, without anyone re-running the Ops seed each morning.
3. The Privacy Policy and the game spec no longer describe a speech-to-text
   excuse that the app does not have.

## Success criteria

- No source, test, doc or env reference to `MURPH_GAME_MEMBER_ALLOWLIST` remains
  outside immutable completed plans.
- With the switch on, any member can enter the game routes and start a game;
  with it off, the game is invisible exactly as before.
- Home still returns `canStartGames` (and `canStartGroups` for multiplayer
  clients), so app builds already installed keep working.
- A Home read by the review account on a later game day replaces a stale seed
  with a fresh one: live game on Day 3, opponent's post today locked. A Home
  read by anyone else does no extra serial work.
- The published privacy PDF and manifest match the edited source.

## Scope

- In scope: `apps/web/src/lib/game/access.ts` and its callers; the game HTTP
  door; `apps/web/src/lib/hosted-ops/app-review-game.ts`; the Home route;
  their tests; `agent-docs/product-specs/weekly-game.md` and its index row;
  `apps/web/legal/privacy-policy.md` and the generated privacy PDF + manifest.
- Out of scope: `MURPH_GAME_GROUPS_ENABLED`; the policy's AI and recap wording;
  iOS; any production setting, deploy or merge; legal document versions.

## Constraints

- Smallest maintainable change. No new scheduled job, state, table or config.
- The legal document version stays `2026-10-26`: a version change would make
  the game's current-Terms gate ask every player to agree again.
- The seed must keep writing rows directly with no push, chat or email send.

## Decisions

- **Allowlist.** `isGameEnabled()` is the only rule. `isGameEnabledFor`,
  `isGameOn(game)` and `GamePeople` are deleted and their callers ask the
  switch. `gameOnWhere()` / `gameOnSql()` stay as the switch in query form, so
  set-based reads keep returning nothing while the switch is off without new
  early-return branches at each caller. The HTTP door becomes the switch; its
  per-member fallbacks (own game, block, report, held invite) served only
  unlisted members and are deleted.
- **Old app builds.** `canStartGames` stays in the Home response and is always
  true when Home can be read (the door already refuses while the switch is
  off). `canStartGroups` keeps following `MURPH_GAME_GROUPS_ENABLED`.
- **Demo game.** Refresh on the review account's Home read, the same
  settle-on-read pattern games already use. The Home route checks, in parallel
  with the Home read, whether the caller is the configured review member. Only
  for that member it compares the seeded live game's Day 1 with the date the
  seed would write today (Pacific game day minus two); when they differ, or no
  such game exists, it runs the existing seed and reads Home again. Freshness
  is derived from rows the seed already writes: no new state, flag or job. A
  refresh failure is logged and Home is served as it stands.
  - Rejected: a daily cron (new job, and still stale between 3 AM and the run);
    refresh at sign-in (a review session outlives one game day); topping up
    only today's opponent post (the 30-day game still ends and needs a manual
    reseed).
- **Speech wording.** Source edit plus `pnpm --dir apps/web legal:pdf`, same
  version, following the earlier in-place regeneration precedent.

- **Words that described the list.** The Terms sentence "Games are invite only
  and free to play" becomes "Games are free to play", and the Bluetooth help
  skill no longer calls the game invite only. Both described the list. The
  Terms PDF is regenerated at the same version, like the privacy PDF. The
  2026-11-02 changelog entry that says "Games remain invite only" stays: it
  was true when published.
- **Roster checks the old rule carried.** The per-game rule was also false for
  a game with no member identities left. Where that mattered it is now an
  explicit check: the command lock, the invite preview, chat bootstrap finish,
  chat candidate ids and the scheduled chat read.
- **Stale seed, measured.** One game day after a seed, Home still shows the
  live game (now Day 4), yesterday's opponent photo still locked, the settled
  game and its IOU, and no opponent post for today. It is not empty; it is a
  game with nothing waiting, and it ends for good after Day 30.
- **Freshness clock.** PostgreSQL's clock, the one Home uses, with the 3 AM
  Pacific boundary the seed already uses; development time travel is ignored.
- **Changelog.** Not applicable for now: the public note that games are open
  belongs with the App Store release, which this PR precedes.

## Product UX

- Effort: Product change.
- Outcome: any signed-in member can open the game, set a profile and start a
  game; the App Review account always lands on a live Day 3 game with the
  opponent's post waiting.
- Reaches: a new member with no invite; an invitee holding a link; two players
  mid-game; a stranger to a game (still refused per game); everyone while the
  switch is off (still hidden); the review account on day one, on later days,
  with two requests at once, after blocking the opponent, and with storage
  down; ordinary members reading Home.
- Proof: HTTP route tests against PostgreSQL for each of those.
- Result: Ready.

## Risks and mitigations

1. Risk: a refresh replaces the review account's games while another request
   holds their ids.
   Mitigation: the staleness check repeats under the pair lock inside the
   seed transaction, so concurrent Home reads on one day seed once.
2. Risk: removing the per-game rule changes behavior for a caller that passed
   an empty or identity-less roster.
   Mitigation: each replaced call site is read for that case; switch-off tests
   stay.

## Tasks

1. Remove the allowlist (source, tests, docs).
2. Refresh the App Review game on the review account's Home read.
3. Remove the speech excuse wording; regenerate the privacy PDF.
4. Focused Vitest and PostgreSQL proof, typecheck, complexity diff, parent review.
5. Draft PR, Ready, start the final review with CI.

## Verification

- `pnpm --dir apps/web typecheck`, workspace `pnpm typecheck` (raw-payload log guard).
- Focused game, game-route, app-review and legal-manifest Vitest files.
- PostgreSQL: `hosted-ops-app-review-game-postgres`, `game-api-postgres`,
  `game-chat-access-postgres`, and the other touched `*-postgres` suites
  against an isolated loopback database.
- `pnpm complexity:diff`.
