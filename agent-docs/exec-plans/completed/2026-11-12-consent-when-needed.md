# Ask for health data when it is needed, not at sign-up

Status: completed
Created: 2026-11-12
Updated: 2026-11-12
Review: reviewed once by ReviewGPT (GPT-6 Pro, architecture preset) on 2026-11-12
against murph `fc7b62c11f`. Four findings; each is accepted or rejected in
"Review findings" at the end and the plan is revised to match. The revisions
were not sent back for a second round, and the reviewer did not have the iOS
repository.

Code read at `origin/main`: murph `fc7b62c11f`, murph-ios `512b1d25`. Inputs: the
health-consent legal look and the code-facts note of 2026-11-12 (both outside the
repo). The legal look's conclusions are input, not settled law. Everything marked
**Lawyer** needs a lawyer's read; none of it is legal advice.


## Decisions made after the plan (2026-11-12)

These override the plan below wherever it left a choice open.

- Recap pictures stay exactly as they are, with today's full set of reference
  photos. The AI step therefore reads "Murph is an AI." and "It reads the
  photos and posts in your games to host them, write your recaps and draw you
  in them.", with OK and a quiet Not now. The documents say the same plainly
  and name the providers.
- Existing players are not asked again. The document minimums are not raised.
  `MURPH_GAME_REQUIRE_CURRENT_TERMS` is not set in production (variable names
  were listed on 2026-11-12; no value was read), so publishing new versions
  asks nobody. Turning that flag on later would ask every player once.
- Allowing health data for a heart rate post also enrols the person in the
  assistant, welcome text included. Accepted.
- Photos, rep counts and routes are not gated as health data; heart rate is.
  They are named in the Consumer Health Data Notice and Privacy Policy anyway.
- A lawyer's read of the wording is wanted and does not block the change.
- Rep counting is paused and untouched, beyond the server check that a rep
  card carrying a heart rate needs the grant.
- Companion admission, the minimum versions and the current-Terms flag are
  unchanged. The optional shared document table was skipped; the two
  registries were updated by hand.

## What the plan got wrong

- Web Delete account was never blocked. `/settings/data-privacy` is a
  standalone page outside the dashboard layout, so the consent modal never
  covered it. Only `/settings` needed the exception, which is what shipped.
- Accepting a game reserves the group chat kickoff; a later lifecycle delivery
  sends it. The journey test drives that delivery itself.
- The app's game push registration waited on any pending consent, so a player
  without the health grant would have had no game notifications. The app
  change makes it wait on the Terms only.
- The app's session restart is a no-op while consent is pending, which is the
  steady state for a player without the health grant. A game session the
  server turns down (an account deleted on the web, say) now goes through
  consent's own read to reach Sign in again.
- The plan's health sheet copy linked the Consumer Health Data Notice. The
  approved board has no link; the built sheet follows the board. Whether the
  sheet must link the notice is lawyer question 16.
- Risk 3 is not solved: a person whose enrolment is refused after Allow
  (billing history) still lands on the account failure screen, at Allow and
  at every later launch, as members with that history already do today.

Lawyer question added: 16. Whether the health question must link or show the
Consumer Health Data Notice it records, given it now carries one sentence.

## Server verification and handoff (2026-11-12)

The PostgreSQL journey passed before changing production behavior. Two members
with only the legal grant create and accept a pair game, publish the reserved
kickoff through the lifecycle service, create a room and claim its game-funded
runtime, post photos from both seats, post words and a route, settle, and read
recap material. Neither player gains usage credit, a personal runtime owner,
workspace, mailbox work or welcome delivery; billing remains `not_started`.
Companion admission is observed and never called. No assistant-access fix was
needed. External runtime signaling is stubbed, and the existing roster support
supplies the provider route; actual model and provider delivery remain unproven.

Nine game-consent cases cover that journey, both heart-rate-bearing kinds with
missing/revoked/granted consent, granted replay, plain reps, and withdrawal
committing after payload preparation but before the post transaction. The
withdrawal leaves no entry or history write. The HTTP refusal is the existing
non-retryable JSON error envelope, with `HEALTH_DATA_REQUIRED` and status 403.

The broader focused run passed 1,836 tests in 82 files. Its remaining consent
persistence file rejected the documented `murph_test_<slug>` database name at
collection; a one-line test guard fix and a Frog entry record that friction.
The isolated rerun passed all six persistence tests, bringing the verified
set to 1,842 tests across 83 files. One pre-existing, opt-in pinned-old-Web skew
case was skipped. Web typecheck, the raw-payload log guard, complexity diff and
docs drift passed. The six new document versions and latest PDFs were generated
with the repository command. All 24 historical versioned PDFs match `HEAD`
byte-for-byte; the parent's six legal Markdown edits were preserved exactly.

The plan's Settings premise was partly wrong: `/settings/data-privacy` is a
standalone session-gated page outside the dashboard layout, with no redirect.
Only `/settings` is exempt from the modal; protected actions retain their own
checks. Acceptance reserves a kickoff for lifecycle delivery rather
than publishing it in the HTTP response. The consent minimums and opt-in
published-Terms gate remain unchanged, including that gate's stricter behavior
when explicitly enabled.

The optional direct-text characterization was skipped because the small
first-contact tests do not exercise a member's persisted state; connecting
that state to inbound processing would expand the harness. Hosted-local,
actual provider/model delivery, iOS/TestFlight and old-native-client replay
were not run on the server side. The app's own proof is in the murph-ios
pull request.

## Goal

A new person installs the app, signs up and plays a 1v1 photo game without ever
seeing a health question. They agree to the Terms and Privacy Policy by
continuing, give one explicit yes to Murph's AI hosting the game, and play.
"Use your health data?" appears only when they do something that needs health
data, and saying Not now only closes it. The legal documents say what the app
does.

## The shape in five lines

1. The game already has its own door (`/api/game/v1`, a signed-in session). New
   players stop being pushed through the health assistant's door. Companion
   admission does not change at all.
2. Sign-up is: number, code, one AI step (one sentence, one button), name, game.
   The Terms and Privacy line sits under Send code. The AI step's button records
   the existing `launch.legal` grant.
3. A player without the health grant is a game-only member: a Murph account with
   the Terms grant and nothing else. No assistant enrolment, no trial usage, no
   runtime, no welcome text. Allowing health data later runs today's admission,
   unchanged, and makes them a full member.
4. The health ask is one small sheet over the game, raised from the places the
   app already raises it (Apple Health, Meals, meal photos, Contacts, the pair
   board) plus the first heart rate post. Not now closes it.
5. One small server check is added: a heart rate post needs the health grant.
   Web Settings stops blocking people who have not allowed health data. The
   legal documents and review notes are rewritten to match.

## The game-only member question

**Recommendation: yes, a game-only member until they opt in, and it needs no new
state.** It is the account that exists today between "agreed to the Terms" and
"allowed health data": a `hosted_member` row with `launch.legal` granted,
`launch.health-data` missing (or revoked), billing `not_started`, no starter
usage grant, no runtime. Today the app shows that person a wall. After this
change it shows them the game.

Why this and not the alternatives:

- **Rejected A: admit everyone through the assistant's door with the Terms grant
  alone** (drop the health check from `requireHostedCompanionMemberIdFromRequest`
  and from enrolment). Smallest server diff, wrong outcome. Every game sign-up
  would get assistant trial usage, a runtime and Murph's welcome text, and the
  runtime treats a missing health grant as allowed (legacy rule in
  `consent.ts`: only `revoked` denies). A player who never allowed health data
  could text Murph and have health chat processed. That is the opposite of the
  decision, and it spends AI budget on people who came for a game.
- **Rejected B: teach admission a second answer** ("admitted, game only", with a
  response field and a skipped enrolment). Works, but changes a shared contract
  and creates deploy skew: an old app that gets "admitted" for a person without
  the health grant goes on to call routes that need active access
  (`initial-onboarding`, `heartbeat`, `status`) and lands on a failure screen.
- **Chosen C: do not call the assistant's door for a game-only player.** The
  game API never needed it: `requireGameMemberAuth` checks the session and
  whether the game is on, game pushes register through the game's own
  `/api/game/v1/push-route`, and the game group chat is funded by the game
  room, not by a player's assistant access (`readGameChatFundingRooms`;
  `canTextGameReminders`: "A game never grants private AI access or creates a
  new direct route"). Old app builds see no server difference at all.

What a game-only member can do: everything in the game (create, accept, post
photos, words, reps and routes, results, prizes, reports, blocks, profile,
notifications, the game group chat, recaps). What they cannot do until they
allow health data: connect Apple Health, see numbers, use Meals or meal photos,
post a heart rate, share Contacts for friendly names, or use the private
iMessage assistant from the app.

## What is true today (verified in code)

Server (murph):

- `apps/web/src/lib/hosted-onboarding/companion-member-access.ts`: admission
  asserts both launch grants (`assertHostedHistoricalLaunchConsentGranted`),
  then enrols a `not_started` member in starter usage
  (`ensureHostedStarterUsageEnrollment`, source `companion_onboarding`, which
  itself requires both grants) and sends the phone welcome for active members.
  Used by `companion/admission` and `companion/sign-in-token`.
- Nothing under `apps/web/src/lib/game/http/auth.ts` reads `launch.health-data`.
  `requireCurrentTermsFor` requires `launch.legal` at the published versions for
  nine write commands, but only when `MURPH_GAME_REQUIRE_CURRENT_TERMS=true`.
  With the flag off, the game API checks no consent; the app's wall is the only
  thing that makes players agree to the Terms.
- Health routes each assert consent themselves and answer
  `HOSTED_CONSENT_REQUIRED`: status, health-metadata, hrv-rmssd,
  sync-diagnostics, sign-in-token, meal-photo enrolment and upload,
  address-book, iMessage mini-app actions, browser vault, billing checkout,
  clinical records, vault export, web group join. Most also require active
  access, which a game-only member does not have.
- The game reacts to an explicit withdrawal (`revoked`) in three places:
  `chat-access.ts` (the room loses AI access), `chat-membership.ts`
  (`hasGameChatRestriction`), `recap-asset-access.ts`
  (`recapReferencesCurrent`). A missing grant does not trigger them.
- The text door is separate and unchanged: an inbound iMessage from a person
  with no assistant access stays on the first-contact flow, and instant start
  can grant trial usage with no recorded consent
  (`docs/legal-consent-implementation.md`).
- Recaps: see "Legal call two" below.

App (murph-ios):

- `AppSession` calls admission at session start. On `consentRequired` it begins
  consent recovery: closes Junction and meal-photo authority, sets
  `phase = .ready`, loads the consent status, and presents the steps.
- `RootView.readyScreen` returns `.gameNeedsConsent` whenever
  `session.requiresLegalConsent` (any pending recovery), which shows
  `GameConsentScreen`: the two steps, then after Not now a page with only Ask me
  again, Sign out and Delete account. The game's own `lookIn()` already runs in
  this state because the phase is `.ready`.
- `LegalConsentSteps` picks its page from the server's
  `status.pendingLaunchScopes`: Terms while `launch.legal` is missing, then
  health data. Step 1 shows three document rows and the zero-tolerance line;
  step 2 shows Workouts, Sleep, Chats, a paragraph and a Details sheet.
- The health ask is already raised on use: `presentConsentRecovery()` is called
  from the Apple Health row and button, Meals, meal photos, Contacts and the
  pair board. The heartbeat, messaging setup, Text Murph buttons and health
  sync already stay off while a recovery is pending
  (`healthDataAuthorityMayRun`, `murphContactAction`).
- The Terms document already carries the zero-tolerance rule ("No tolerance for
  objectionable content or abusive users", Terms, Games section).

So the wall is two lines of routing in the app plus the fact that the game API
leans on the wall for the Terms. The assistant's door is not in the way.

## Server change (murph)

Admission: **no change.** `requireHostedCompanionMemberIdFromRequest` stays the
health assistant's door, still requires both grants, still enrols. It is now
reached only when a person has allowed health data.

Terms: **no change.** The app's AI step still blocks the game until
`launch.legal` is recorded, exactly as step 1 does today, and
`MURPH_GAME_REQUIRE_CURRENT_TERMS` keeps its meaning. An always-on server Terms
check was in the first draft and is dropped (review finding 1): the new flow
does not need it, and it would newly refuse people who play from the group chat
without the app.

1. **A heart rate post requires the health grant.** In the game's one write
   path (`runGameCommand` in `apps/web/src/lib/game/service.ts`), a `post`
   whose kind is `heart_rate`, or a rep card carrying `data.heartRate`, requires
   `launch.health-data` to be `granted`. Read the grant inside the mutation
   transaction, after the member row is locked, so a withdrawal that commits
   while the post is being prepared wins (withdrawal locks the same row in
   `revokeHostedConsentScope`). Refuse with a game error the app can tell apart
   (for example `HEALTH_DATA_REQUIRED`, 403). Photos, words, reps without heart
   rate and routes are not gated (legal call one). Putting it in the write path
   rather than the HTTP adapter covers every caller; the chat photo path posts
   only `photo` entries. Existing players who allowed health data see no
   difference.
2. **Web Settings never shows the blocking consent modal.** The dashboard
   modal (`DashboardLegalConsentGate`) lifts only for `pathname === "/settings"`
   with a `revoked` grant, and the app's Delete account link opens
   `/settings/data-privacy`, so a person who has not allowed health data is
   told to allow it before they can delete their account. Make `/settings` an
   unconditional exception and delete the `healthDataExplicitlyWithdrawn`
   condition: Settings already has its own health-consent control
   (`settings/page.tsx`), and deletion has its own session check
   (`privacy/delete/route.ts`). Update `dashboard-legal-consent-gate.test.tsx`.
   Export is not part of this: vault export still answers
   `HOSTED_CONSENT_REQUIRED` for a missing grant, a game-only member has no
   health vault, and no export of game data exists today (see Risks).
3. **Legal documents and versions** (section "Wording" below): edit the
   markdown files; bump the published versions in `consent.ts`
   (`HOSTED_TERMS_OF_SERVICE_VERSION`, `HOSTED_PRIVACY_POLICY_VERSION`,
   `HOSTED_HEALTH_NOTICE_DOCUMENT_VERSION`, which the Consumer Health Data
   Notice and the Health AI Safety Disclosure share) **and** the separate
   hard-coded `DOCUMENTS` table in `apps/web/scripts/generate-legal-pdfs.ts`,
   or the PDFs keep the old versioned filenames; leave
   `HOSTED_CONSENT_MINIMUM_ACCEPTED_VERSIONS` alone so no existing grant goes
   stale; regenerate PDFs and the manifest; update the literal versions in
   `legal-manifest.test.ts` and `legal-july-grant-no-break.test.ts` (its July
   compatibility assertions must stay green) and `legal-documents.md`.
   Recommended first commit, only if it nets deletion: move the document table
   (id, title, version, links) into one dependency-free module read by both
   `consent.ts` and the generator, and have the manifest test compare against
   it instead of a third copy.
4. **Owner docs:** `docs/legal-consent-implementation.md` (a player can be in
   the game without the health grant; the heart rate check; the Settings
   exception), `agent-docs/product-specs/weekly-game.md` (heart rate gate).

Routes that keep asserting the health grant on their own, unchanged: every route
in the "Health routes" list above, plus runtime AI admission, device webhooks,
scheduled sync and the Cloudflare runner barrier, which deny on `revoked`.

Assistant enrolment and usage for a player without the grant: none. No starter
usage grant, no personal runtime, no welcome text, no private reminders or
private kickoff (those already require existing AI access and a direct route).
The game room is a separate owner with its own runtime and allowance, funded by
the game as today.

Not changed, on purpose: the `revoked` checks in the game (see "Withdrawal"),
the text door, the legacy rule that a missing grant is not a withdrawal.

## App change (murph-ios)

1. **Number screen** (`Auth/LoginView.swift`): one line under Send code, "By
   continuing you agree to the Terms and Privacy Policy.", both linked.
2. **The AI step** replaces step 1 for a new player (the case `termsTitle`
   already distinguishes as "Before you play"): a title, one sentence, one
   button, and a quiet Not now. No document rows, no second paragraph, no
   zero-tolerance line (the Terms carry it). The button calls the existing
   `acceptRequiredLegalConsent(only: .legal)`, which records `launch.legal`
   (Terms, Privacy Policy, Health AI Safety Disclosure) against the server's
   current versions. Not now opens a system confirmation with Sign out and
   Delete account, so account deletion stays reachable without a page.
   The updated-Terms ask for an existing player (`GameTermsAsk`, title "Murph's
   Terms", document rows) is unchanged.
3. **After the AI step, go to the game.** When `launch.legal` is granted and
   only health data is pending, close the consent presentation instead of
   sliding to step 2, and leave the recovery pending. Delete the two-dot
   progress and the step-to-step transition.
4. **Routing:** `RootView.readyScreen` shows the game unless the Terms grant is
   pending. Delete `ReadyScreen.gameNeedsConsent` for the health-only case and
   delete `GameConsentScreen` with its Not now page. A session that starts with
   only health pending (a returning game-only member, or a member who withdrew)
   loads the status and goes straight to the game without presenting anything.
5. **The health ask** is the existing consent sheet, presented over the game
   (`consentOpensInSheet` true when the pending step is health data): title "Use
   your health data?", at most two short sentences, Allow, Not now. Delete the
   Workouts, Sleep and Chats rows, the Details sheet (`LegalConsentDetails`) and
   the `isGame` copy variants. Not now is the existing
   `dismissConsentRecovery()`: it closes the sheet and nothing else.
6. **Where it is raised:** the six existing `presentConsentRecovery()` call
   sites, plus one new one: before the first heart rate capture
   (`Game/HeartRate`, WHOOP connect, and rep tape when a heart rate is added).
   The server's refusal in server change 1 is the backstop; on that refusal the
   app raises the same sheet. Text Murph buttons
   do not show for a game-only member (no contact action is loaded), so the
   private assistant is reached only after Allow.
7. **Allow:** unchanged path. The grant is recorded, the session resumes through
   admission (which now enrols the person), and the blocked action runs. Two
   fixes so this is safe over a live game: keep the game mounted while the
   session resumes instead of the launch spinner, and if admission fails after
   the grant is saved (for example the retryable runtime-wake answer), return to
   the game with the health features still off and a short inline message; the
   next health action or launch retries admission. Never the root failure
   screen, and never the question again: "consent granted" and "admitted" are
   two different facts, and the app must be able to hold "granted, not yet
   admitted" without re-asking or re-recording (review, remaining iOS proof).
   Today's pending-recovery state does not obviously represent that, so prove
   it with a test that fails admission after a successful grant.
8. **Copy cleanup:** remove "Games pause until you allow again" everywhere.

No new stored state in the app: "game-only" is the pending health recovery that
exists today.

Other agents are landing the allowlist removal (`game/access.ts`) and the "Not
open for you yet" screen (`GameInMurph.swift`). This plan builds on top of both
and touches neither rule; `GameConsentScreen` lives in the same file, so rebase
before deleting it.

## Wording

All of this needs a lawyer's read before it ships. **Lawyer.**

In the app:

- Number screen: "By continuing you agree to the Terms and Privacy Policy."
- AI step. Title: "Murph's AI hosts your games". Sentence: "It reads the photos
  and posts in your games to host them and write your recaps." Button: "OK".
  Quiet: "Not now". If generated pictures of players stay on (founder decision
  below), the sentence must say so: "It reads the photos and posts in your games
  to host them and make your recaps, including pictures of you."
- Health ask. Title: "Use your health data?". Sentences: "Murph and its AI
  providers use your Apple Health data, heart rate and meals to show your
  numbers and write replies, as the health data notice explains." (notice
  linked) "Withdraw anytime in Settings." Buttons: "Allow", "Not now".

Why a step and not a line on Shake on it or Send: Apple's 5.1.2(i) asks for
explicit permission before personal data goes to third-party AI. A sentence
above a button whose meaning is "accept this challenge" bundles two decisions
into one tap, and there are two such buttons (Send for a challenger, Shake on it
for an invitee), so the permission would be recorded in two places and the
Terms grant would have to move after the game's first write. One step with one
meaning, recorded through the grant and route that already exist, is both the
stronger answer to Apple and the smaller change. No defensible zero-screen
variant was found.

Privacy Policy, section "I. Games":

- New paragraph: "**Why we collect game data.** We collect your game photos,
  words, rep counts and routes because the game you asked to play cannot run
  without them. We do not sell them or use them for advertising. Heart rate is
  health data: the app asks before your first heart rate post, and you can
  withdraw that permission in Settings."
- New paragraph: "**Recaps.** When a game ends, Murph makes a recap for its
  players. To make it, our AI provider, OpenAI, receives what the players
  posted in that game (photos, words, results, and numbers such as rep counts,
  heart rate summaries and route distance), each player's first name and
  profile photo, and the messages sent in the game's group chat. OpenAI acts on
  our instructions, and its terms with us do not allow it to use this content
  to train its models. We never ask an AI model to work out who a person is or
  to match a face to a name."
  If generated pictures stay on, add: "A recap can include pictures made by AI
  that show the players in a scene from their game. To make them, OpenAI's
  image model receives a player's profile photo and game photos as a guide to
  how they look. A recap can also include a short song made by ElevenLabs from
  lyrics that can include players' first names."
- Replace, in "Group chat", "Messages and photos you send in that chat are
  handled like any other message to Murph (see Section 6)" with: "Murph's AI
  reads the messages and photos sent in that chat to host the game: to reply,
  keep track of the game, remind players and make the recap."

Consumer Health Data Notice:

- Section 3, new bullet: "**Game data**, such as a heart rate summary you post
  as proof in a Murph game (its duration and average, low and peak beats per
  minute). Murph also collects game photos, rep counts with each rep's time and
  depth, and route distance and time. We name them here even though we do not
  treat them as Consumer Health Data."
- Section 5, new bullet: "run the games you play, show your posts to the other
  players, and write game messages and recaps with our AI model providers;"
- Section 5, new paragraph: "**When we ask.** Murph asks for your consent the
  first time you use a feature that needs Consumer Health Data, such as
  connecting Apple Health, posting a heart rate, using Meals, or texting Murph.
  Playing a game with photos, words or rep counts does not need this consent;
  we collect those because they are necessary to provide the game you asked
  for."
- Section 10, add: "Withdrawing consent does not end your games or close your
  account."

Terms, "Games": new paragraph "**AI host.** Murph hosts games with AI. Our AI
providers read what players post in a game, including photos, and the game's
group chat, to run the game and make its recap. Our Privacy Policy says which
providers and what they receive."

Subprocessors: add named rows for OpenAI (Responses API and Images API: game
posts, photos, names, group chat messages; no training; up to 30 days of abuse
monitoring logs) and ElevenLabs (Music: recap lyrics, first names).

App Store (murph-ios `agent-docs/app-store-privacy.md` section 4 and the
review-note checklist, `agent-docs/app-store-submission.md`), replacing the
text that says the game requires both grants:

- "Third-party AI (5.1.2(i)): after sign-in, one step tells the person that
  Murph's AI reads the photos and posts in their games to host them and write
  recaps, and asks for an explicit OK before any game content is sent. The
  provider is OpenAI, named in the Privacy Policy, under terms that forbid
  training on the content."
- "Health data (5.1.1): the app does not ask for health data at sign-up. It
  asks the first time a feature needs it (Apple Health, heart rate, Meals). Not
  now closes the question and the game keeps working. Withdrawal is in
  Settings."
- "Objectionable content (1.2): the Terms agreed to at sign-up carry the
  zero-tolerance rule; report and block are on every post and player."
- Check the App Privacy label against the recap flow before submitting.

## Legal call one: what counts as health data for gating

Decided by the founder: exercise photos and rep counts are not gated. They are
collected because they are necessary to run the game the person asked for, are
never sold or used for ads, and are named in the Consumer Health Data Notice and
Privacy Policy anyway. Heart rate is health data and stays behind the health
ask (server change 1, app change 6). A lawyer's read is wanted and does not
block shipping. **Lawyer.**

Consequence to state plainly: a rep card posted without a heart rate, a route
and a proof photo all go to the AI recap for a player who never allowed health
data. That rests on the necessity basis in Washington and Nevada; Connecticut
has no clear equivalent. **Lawyer.**

## Legal call two: where recap photos go (verified)

From the code at `origin/main`:

- **Provider and API.** OpenAI, two ways. (1) The recap is written by one
  hosted model turn (GPT-6.1 Sol) that reads the game's material, including the
  players' photos, through the normal read tool. (2) Scenes are made by
  `POST https://api.openai.com/v1/images/edits` with model
  `gpt-image-2.6-sunburst` (`packages/assistant-engine/src/assistant-codex/
  openai-image-generation.ts`, `generate-image-tool.ts`), with player photos
  attached as reference images. The optional 20-second song goes to ElevenLabs
  Music (`api.elevenlabs.io`) with a style line and short lyrics that include
  players' first names.
- **Which photos.** `readRecapSourceReferences` (`apps/web/src/lib/game/
  recap-inputs.ts`): each player's profile photo, the private contact photo the
  other player gave them, this game's photo posts, and recent photo posts from
  the same pair's earlier games. The code comment says of the last group: "a
  past game's photo is a face, never a print."
- **Input only, or images of the players?** Both. The craft guide
  (`packages/hosted-execution/src/recap-show-craft.ts`) defines a scene as "a
  picture we generate of the players acting out one real moment" and tells the
  model to pass `referenceImageRefs` so the picture looks like them. **Images
  of players are generated from their photos.** This is flagged as its own
  founder decision below and is not decided here.
- **Identify or match.** Nothing asks a model to work out who someone is. The
  host labels each reference with the player it belongs to. Reproducing a
  likeness from a face photo is still the thing the biometric laws may care
  about. **Lawyer** (question 6).
- **Is it on in production?** The show runs only when
  `MURPH_GAME_RECAP_SHOW_ENABLED=true` (`game/access.ts`: "Producer stays dark
  until compatible consumers and provider privacy gates are approved"). The
  value in production is not in the repo and was not read.
- **Provider terms, read today from the published pages, not from memory.**
  OpenAI's API data-controls page: API data "is not used to train or improve
  OpenAI models" unless the customer opts in; abuse monitoring logs are kept
  "for up to 30 days" for `/v1/images/edits`, `/v1/images/generations` and
  `/v1/responses`; Zero Data Retention needs OpenAI's prior approval; image
  inputs are scanned for CSAM and a flagged image is kept for manual review
  even under Zero Data Retention. That page lists `gpt-image-2` and
  `gpt-image-1.5` as Zero Data Retention compatible and does not name the model
  the code uses. ElevenLabs' Terms (last updated 9 October 2026): content may
  be used "to improve the Services", with an opt-out under Data use in the
  account; a Data Processing Addendum covers business customers.
  **Could not read:** OpenAI's Services Agreement and Data Processing Addendum
  pages (the fetch was refused), so how the addendum is entered into is
  unverified.

**The rule this plan adopts:** player photos go only to a provider whose terms
with Murph forbid training on them; nothing asks a model to identify or match a
person; the Privacy Policy names the provider.

**Founder decision, not made here: generated pictures of players.** Options:
(a) keep scenes with player likeness and say so in the AI step and Privacy
Policy; (b) turn scenes off (or cast only the Murph character) so photos are
input for writing and shown as whole prints only; (c) keep them but only from
photos posted in that game, dropping profile, contact-label and past-game
photos as references. The contact-label photo deserves its own look in any
case: it is a photo one player gave of the other, used to generate that other
person's likeness.

**Things the founder must do by hand:**

1. OpenAI organization: confirm data sharing for model improvement is off, and
   that a Data Processing Addendum is in place; decide whether to ask for Zero
   Data Retention.
2. Confirm production recap turns and image calls run on that API
   organization's key, not a ChatGPT subscription sign-in (developer machines
   use one; consumer terms differ).
3. ElevenLabs account: turn off use of content for training (Data use), and
   accept its Data Processing Addendum, before lyrics with names are sent.
4. Say whether `MURPH_GAME_RECAP_SHOW_ENABLED` and
   `MURPH_GAME_REQUIRE_CURRENT_TERMS` are on in production.
5. Send the wording above and the lawyer list to a lawyer.
6. Update the App Store review notes and App Privacy label at submission.

## Withdrawal: what a person keeps and loses

Keeps: the account, every game in the app (play, photo, word, rep and route
posts, results, prizes, history), game notifications, account deletion.

Loses, as today: Apple Health and device sync, numbers, Meals and meal photos,
Contacts sharing, the private iMessage assistant (Murph answers with the
existing "paused" notice), and their personal runtime is stopped. New: heart
rate posts are refused until they allow again. Cards already posted stay in the
game's record.

What happens to that player's games in the group chat is unchanged by this
plan, and the first draft described it wrongly (review finding 2). What the
code does today while a player in a game has an explicit withdrawal on file:

- Murph ignores that player's own messages (the sender check at Linq ingress).
- Game material is withheld from the room's AI and from delivery
  (`hasGameChatRestriction`), and recap media and previews stop resolving for
  both players (`recapReferencesCurrent`), so lifecycle messages and the AI
  recap stop for that game.
- The room loses its game-funded AI access (`readGameChatFundingRooms`). But a
  room whose other player has their own assistant access keeps answering that
  player's ordinary messages, because owner and participant access are checked
  before game funding (`readHostedRuntimeAiAccessDecision`). The room is not
  silent, and nothing stops a warm room runtime.

That is the same participant-level rule Murph already documents for every group
chat ("an explicitly revoked exact message sender or shared-data grantor is
excluded even when another group participant keeps the synthetic room runtime
active", `docs/legal-consent-implementation.md`). This plan keeps it and does
not add a whole-room stop: the decision is that a person who withdraws keeps
their games, so the direction is fewer consequences, not more. The cost that
remains falls on the other player too (no recap show, no lifecycle messages for
that game). **Lawyer** (question 2). A follow-up can delete the game's
`revoked` checks once heart rate is filtered out of what the room's AI reads
for a withdrawn player, which would make "withdrew" behave like "never
allowed".

The app's old promise "Games pause until you allow again" is deleted because it
is not true.

## Deploy order and skew

Because admission does not change, the server and the app do not depend on each
other:

- **Old app, new server:** identical to today. Existing members who granted
  everything pass the heart rate check. A new person on an old build still sees
  the old two steps.
- **New app, old server:** the game-only path works, because it uses only the
  game API and the consent routes that exist today. But a heart rate post would
  be gated by the app alone, and web Settings would still block a game-only
  member, so the server ships first.
- **Existing members:** notice nothing, provided the document minimums are not
  raised. One exception to check: if `MURPH_GAME_REQUIRE_CURRENT_TERMS=true` in
  production, bumping the published Terms and Privacy versions asks every
  player once to agree again at their next game write (the existing "Murph's
  Terms" step). That would also collect the AI permission from existing
  players, who have never been asked about recap photos. Founder call: leave
  the flag as it is, or accept the one-time ask. This plan does not turn it on.

Order:

1. Lawyer reads the wording. Founder does the provider steps (OpenAI,
   ElevenLabs) and makes the generated-pictures decision.
2. murph PR: documents and versions, server changes 1 to 4. Merge deploys Web.
   No Cloudflare runtime change, no migration. This goes first.
3. murph-ios PR: app changes 1 to 8 and the review notes. TestFlight, then App
   Review with the new notes.

The documents must be live before the new build reaches people, because the AI
step records a grant against the published versions.

## What gets deleted

- murph-ios: `GameConsentScreen` and its "No problem." page; the
  `gameNeedsConsent` routing for health; the two-step progress dots and
  step-to-step slide; the Workouts, Sleep, Chats rows; `LegalConsentDetails`
  and its five facts; the `isGame` copy variants and "Games pause until you
  allow again"; the document rows and zero-tolerance line on a new player's
  first step.
- murph: the `healthDataExplicitlyWithdrawn` condition in the web consent
  modal; if the shared document table is taken, the generator's own `DOCUMENTS`
  versions and the manifest test's literal map; wording in
  `docs/legal-consent-implementation.md` and the App Store docs that says the
  game requires both grants.
- Possible later: the `MURPH_GAME_REQUIRE_CURRENT_TERMS` flag (once the founder
  decides whether players always need the published Terms); the `revoked`
  checks in the game (see Withdrawal).

## Risks and failure modes

1. **A game-only member has never been run end to end.** The legal look
   inferred it from auth code. Prove it before building anything else: a
   Postgres test and one hosted-local run where two members with only
   `launch.legal` create, accept, post photos, get the group chat kickoff,
   settle and receive a recap. If a step needs assistant access, fix that step,
   not admission.
2. **Allow succeeds, admission then fails.** Covered in app change 7.
3. **Enrolment arrives late.** A person who allows health data weeks after
   sign-up is enrolled then, through the same code as today. Starter enrolment
   can answer "blocked" (billing history); the app already maps that to the
   access-required failure. In the new flow it must leave the game up.
4. **Heart rate allow makes a full member.** Allowing health data for a heart
   rate post also enrols the person in the assistant, with the welcome text,
   because the grant is one grant. Accepted to avoid a third account state.
5. **A game-only member texts Murph's number directly.** They are treated like
   any first-time texter (first-contact flow, possibly instant start with no
   recorded consent). That door has always worked this way and is out of scope,
   but it means the health ask is not reached by text. Characterize with a
   test; **Lawyer** (new question 9).
6. **The Terms grant recorded by the AI step.** The tap records the Terms,
   Privacy Policy and Health AI Safety Disclosure, while the screen shows one
   sentence about AI and the Terms line sat one screen earlier. **Lawyer** (new
   question 10).
7. **Concurrent work in `GameInMurph.swift` and `access.ts`.** Rebase onto both
   before starting.
8. **Export for a game-only member.** Settings shows Export, but vault export
   refuses a missing grant and there is no health vault to export; game data
   has no export at all today. Not built here. Until it is, access and
   portability requests for game data go through the privacy contact address.
   Do not create a personal runtime just to make Export succeed. **Lawyer**
   (new question 15).
9. **Terms are still enforced by the app, as today.** With the flag off the
   server accepts game writes from a signed-in session without the Terms grant.
   Unchanged by this plan; listed so nobody assumes otherwise.

## Verification

- Server, focused: a heart rate post and a rep card with a heart rate, with the
  health grant missing, revoked and granted; photo, words, route and plain rep
  posts with the grant missing; the refusal's code and status. A deterministic
  Postgres interleaving: pause a heart rate post after its preliminary work,
  commit a withdrawal, resume, and assert no entry or history row is written.
- Server, documents: every version offered for acceptance equals the manifest
  entry and the PDF filename; regeneration leaves historical PDFs byte-identical;
  a July grant still satisfies the minimums and sees no ask; a new acceptance
  records the new versions; a form holding an older version gets the existing
  stale-version answer.
- Server, journey (risk 1): two Terms-only members through a whole pair game in
  Postgres tests and once in hosted-local: create, accept, photo posts, group
  chat kickoff, settle, recap. Assert neither player has a starter usage grant,
  a personal runtime or a welcome delivery; the game room has its own runtime.
- Existing member: a member with both grants replays admission, status, the
  Apple Health sign-in token, a heart rate post and a game write with no new
  prompt.
- Web: Settings and Delete account are reachable with both grants missing, only
  health missing, health revoked, and Terms stale; protected health actions on
  that page still refuse.
- App, the path the founder cares about, on a clean simulator against
  hosted-local and again on TestFlight against production: install, number,
  code, AI step, name, start a photo game, accept on a second account, post a
  photo, see the other post. Assert by screen identifier that
  `consent.healthData` never appears and `consentGate` no longer exists.
- App, health in context: tap Apple Health, see the sheet, Not now, back in the
  game; tap again, Allow, the iOS Health sheet opens. Same for Meals and for
  the first heart rate post.
- App, granted but not admitted: make admission fail after a successful Allow;
  the game stays up, the question does not come back, and the next health
  action retries admission.
- App, back-out: Not now on the AI step offers Sign out and Delete account.
- App, withdrawn member: withdraw on web, relaunch, lands in the game, heart
  rate post asks again.
- Skew: old TestFlight build against the new server (existing member and new
  sign-up); new build against the new server.

## Questions for a lawyer

Carried over from the legal look:

1. Whether heart rate cards, rep counts and depth, route distance and proof
   photos are consumer health data in Washington, Nevada and Connecticut, and
   whether a face photo is "biometric data" under RCW 19.373.010(4).
2. Whether conditioning the whole app on health-data consent is "freely given",
   and whether pausing games on withdrawal is unlawful discrimination. (Now
   narrower: is going quiet in the group chat and a plain recap, for both
   players, after one withdraws.)
3. Whether Murph's AI and health-sync contracts make those providers
   processors, so that transfers are not "sharing" (Washington) and are
   authorized (FTC).
4. Whether one consent can cover collection and sharing, or a second is needed.
5. Connecticut after July 1, 2026: consent plus "reasonably necessary", and
   whether the requested-service carve-out helps.
6. Biometric exposure from sending face photos to an AI generator as reference
   images. Engineering has now confirmed the provider is asked to draw the
   players from those photos.
7. Whether any chatbot law reaches the iMessage assistant.
8. Not examined: minors and age gating, and whether favours as stakes raise any
   contest or gambling question.

New from this plan:

9. The text door: a person can start the assistant by text with no recorded
   health-data consent. Is a first-message notice enough?
10. Whether a by-continuing line for the Terms and Privacy Policy plus one
    recorded tap on the AI step is valid acceptance of all three documents the
    grant records.
11. Legal call one: resting game photos, rep counts and routes on "necessary
    for the requested service" with no consent, including in Connecticut.
12. Existing players were never asked about recap photos going to AI. Is a
    one-time ask needed for them?
13. Using a photo one player supplied of another (the contact label) to
    generate that other person's likeness.
14. The exact wording in "Wording" above.
15. Access and portability for game data when there is no export in the product.

## Review findings

One ReviewGPT round (GPT-6 Pro, architecture preset, model verified by the
tool), 2026-11-12, on the first draft of this plan plus the murph archive. Each
claim below was checked against the code before deciding. The revised plan was
not re-reviewed: no revision adds state, a migration or a new authority path.

1. **Put the consent rules in the game's one write path, not the HTTP adapter
   (P1).** Evidence checked: `requireCurrentTermsFor` runs only in
   `http/command-route.ts`; `handleGameChatPhoto` and the by-ID group acceptance
   call the service directly; `revokeHostedConsentScope` locks the member row.
   Also: "every existing player has the Terms grant" is not something the
   server guarantees.
   - Heart rate check: **accepted.** Moved into `runGameCommand`, read inside
     the transaction under the member lock, with the interleaving test.
   - Always-on Terms check: **rejected by deleting it** rather than moving it.
     The new flow keeps the app's Terms step exactly as blocking as today, so
     the server check was hardening the plan does not need, and moving it into
     the write path would start refusing chat-only players who never saw the
     app. Terms enforcement stays as it is (risk 9).
2. **The three `revoked` checks do not make a game room go quiet (P1).**
   Evidence checked: `readHostedRuntimeAiAccessDecision` admits a room through
   its owner or any participant with access before it consults game funding;
   withdrawal reconciles only the withdrawing member's runtime.
   - The factual correction: **accepted.** The Withdrawal section now says what
     actually happens and no longer claims a barrier.
   - The proposed fix (derive a room-wide processing restriction, apply it
     before every funding source, stop affected room runtimes): **rejected.**
     It adds a rule and a runtime stop in order to deliver whole-room silence,
     which nobody asked for and which cuts against the decision that a person
     who withdraws keeps their games. The existing documented rule for every
     group chat is participant-level exclusion, and this plan keeps it.
3. **Let Settings own its consent prompt; export is a separate problem (P2).**
   Evidence checked: the modal's exception is `/settings` plus `revoked` only;
   Settings mounts its own health-consent control; vault export refuses a
   missing grant and needs a vault replica.
   - Unconditional `/settings` exception: **accepted** (it deletes a
     condition).
   - Reworking export: **rejected for this change**, and the plan's promise is
     corrected: it no longer says a game-only member can export. Recorded as
     risk 8 and lawyer question 15.
4. **Published document versions have two owners (P2).** Evidence checked:
   `generate-legal-pdfs.ts` hard-codes its own `DOCUMENTS` versions; the
   manifest and July tests hard-code literals.
   - The missed steps: **accepted.** Server change 3 now names the generator
     table and both tests.
   - One shared table: **accepted as a recommended first commit, only if it
     nets deletion**; otherwise update the three places by hand.

Also taken from the review: the game room's own runtime is expected in the
journey test (only the players must have none), and the iOS state "granted but
not yet admitted" must be proven in the app (app change 7).

How the review was run, for the record: the two lanes named for this task could
not run it. review lane A's ChatGPT account showed a Free plan, so the tool could not
confirm the Chat surface. review lane B's app bundle is one Brave version behind
the installed browser and its profile lock is stale, so it cannot launch.
review lane C offered no Pro model. The review ran on review lane D, the fourth lane in the
repo's own pool (`agent-docs/operations/pr-reviewgpt-loop.md`).
Completed: 2026-11-12
