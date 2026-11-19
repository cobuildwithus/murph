# Medal share: the postcard

Shipped on 2026-11-19. The server half (#5210) went live in production at 19:19 UTC. The migration was applied: the share's primary key is `storage_key` and `game_progress_share_photo` exists. No 5xx followed the deploy. The app half is murph-ios #706, which passed ReviewGPT rounds 1 and 2 and went out in TestFlight build 119 at 20:36 UTC. Both release workflows passed on that build's commit.

Changes during the build: CI's complexity guard split `postcard()` into route, height and time functions, and the HostedMember privacy seam test now lists the photo relation. In the app, a dark top band inks the postmark light, the SE row drops the pill's icon before it wraps, and an open drawer reads the share again when "Back at" passes.

Status: completed
Created: 2026-11-19
Updated: 2026-11-19
Completed: 2026-11-19

## Goal

Build the medal share design the owner decided on in Paper ("Murph · Progress designs (Nov 17)", page "Medal share, final (Nov 18)"). Today a medal opens a full-bleed photo card. The decided design is a paper postcard:

1. **Medal side** (opens, making, later, pictures off). The place name sits top left. A stamp (36% of card width) carries the amount, with a ring date postmark (25%) overlapping it. Below that come the drawing, the context line and the wordmark.
2. **Picture side** (ready). The generated picture is exactly 2:3, inset in the card (370×555 on a 390 card). The place name and one short line ("Enough pushups to scale it") sit top left in white. A smaller stamp (28%) and postmark (21%, 8 pt further left) sit top right, and the wordmark bottom right. No one's name is on the card in any state.
3. **One row of buttons** in every state:
   - Opens: Put me there / Send / Share.
   - Making: Send in Messages, disabled, with a veil over the drawing and a "Making your picture NN%" pill.
   - Ready: Change photo / Send / Share.
   - Later: "Back at 5:09 PM", one plain muted line in the Put me there spot, then Send.
   - Pictures off: Send in Messages / Share.
4. **Which photo of you?** Only the first picture asks. The grid shows the profile photo (preselected), recent photo posts, Take one and From Photos. No captions sit under the photos (owner Paper comment). With no photo anywhere, only Take one and From Photos show. After the first pick, Put me there is one tap. The pick is kept for medal pictures only and never becomes the profile photo. Settings › Pictures of you shows Your photo with Change, plus Turn off, which deletes the pictures made and the photo.
5. **Zones.** The prompt reserves the top band for the words and marks. If a face still lands under the marks, the app mirrors the marks to the top left and moves the place name to the bottom left over a soft shade. The shared PNG uses the same layout.
6. Dark mode keeps the postcard paper. Bold Text xLarge, the SE, the 17 Pro and the Duo (closed and open) are all laid out.

## Success criteria

- Every medal kind (height, route, sleep, plank or time) gets a server-written `place`, a `line` of at most 32 characters, and a `stamp` with an amount, a unit of at most 16 characters, a spoken form and an art. Tests check every ladder entry against these limits.
- The number rule matches the Stamp board:
  - Under 100,000: every digit.
  - 100K to 999K: K.
  - 1M to 9.9M: one decimal, with ".0" dropped.
  - 10M and up: whole millions.
  - Always rounded down.
  - So 2,450,000 is "2.4M" and 999,999 is "999K".
- The image prompt has a Layout section built from one zones constant, and the same constant goes out with the share view. The "central 3:4 crop" and "Leave quiet space for card text" lines are gone.
- A member who has picked a medal photo starts a picture with one POST and no photo read from game media. With no pick, the view is `needs_photo`.
- Turning pictures of you off deletes the made pictures (as today) and the medal photo's stored copy.
- Build 118 keeps decoding every share view.

## Scope

In scope:
- murph: the share card fields, the stamp number rule, the postmark, the zones constant and the prompt layout, the bank `place` fields for time entries, the medal photo (store, pick, use, delete), and the `later` presentation from draft #5180.
- murph-ios: the postcard (both sides), the stamp with 4 arts, the ring postmark, the button-row states, the Which photo step, the making veil, the face check and its mirrored layout, the shared PNG, Settings › Pictures of you, and Duo, dark and Bold Text.
- Also in the iOS PR: the "Painting the map" pill moves off the end town's label. It covered the end town's name in an 11-19 screenshot.
- TestFlight build 119 after both land.

Out of scope:
- A server retry when the face lands under the marks.
- Captions under photos.
- Changing the 5 a day / 30 in 30 days picture limits.
- Making the medal photo the profile photo, either way.

## Constraints

- Prompts name places and poses only, never the person. The model gets the reference photo and the prompt, nothing else. No artist names.
- Copy: no em dashes, no "about" before numbers, and no "generate".
- No old-build compat code. Build 118 must still decode, which it does:
  - It ignores unknown card keys.
  - It reads an unknown presentation `state` as `.medal`.
- Contract changes are additive. The old card fields (`name`, `contextLine`, `valueText`, `face`, `messageText`) stay, because 118 decodes them as required.
- External calls (OpenAI, the media store) stay outside DB transactions, as `startProgressShare` does today.
- Synthetic names in tests and fixtures.

## Design

### 1. `later` (from #5180)

Rebase draft #5180 onto main, and land it first.

When the quota or another live picture blocks a new one, GET and POST both return `{ state: 'later', availableAt }`. GET never starts anything. `shareAvailableAt` replaces `shareRetryAfter`.

The app shows "Back at 5:09 PM" from `availableAt`. Build 118 reads `later` as the medal card.

### 2. Card fields (share-card.ts)

New fields on `card`. All server-written; the app formats nothing.

- `place`:
  - Height landmark: the bank name ("Mont Blanc").
  - Route: the leg's name when it has one ("Around Iceland"). Otherwise the text before the first comma of each saved end ("Portland to Seattle"), which is how the Steps page and today's card already name the route.
  - Time entry: the bank's new `place` ("Sea of Tranquility", "New Zealand to China").
  - A found (looked-up) entry, or a searched bank entry with no `place`: its `short`, else its name, cut at a word to 28 characters.
- `line`, at most 32 characters, from one table keyed by kind and activity:
  - Height: "Enough pushups to scale it", "Enough pull-ups to climb it", or "Enough {activity} to climb it".
  - Route: "Walked the whole way" (steps or walk), "Ran the whole way" (run), or "Went the whole way".
  - Sleep: "Slept as long as {as}". For example "Slept as long as a godwit flies".
  - Plank or time: "Planked longer than {as}" or "{Did activity} longer than {as}". For example "Planked longer than a moonwalk".
  - `as` is a new bank field: a short noun phrase. An entry without one (found, searched or custom) gets "Slept as long as it took" or "Planked longer than it lasted".
  - Any line still over 32 characters (a long custom activity) falls back to the kind's plain line: "Enough reps to climb it", "Went the whole way", "Slept as long as it took", "Held on longer than it lasted".
- `stamp: { amount, unit, spoken, art }`:
  - Height: the threshold reps, ceil, in the exercise noun: PUSHUPS, PULL-UPS, SQUATS. A custom exercise is REPS.
  - Steps route: the route's steps at 2,000 a mile (the rate routes already use), as STEPS.
  - Run route: MILES or KM, by the client's units.
  - Sleep: whole hours, as HOURS ASLEEP.
  - Plank: whole minutes, as MINUTES PLANKED. Under a minute it's SECONDS PLANKED, which fixes today's "0 minutes" on a 59 s rung. From 10 hours it's HOURS PLANKED.
  - Any other time activity: the same steps as plank, without the verb (MINUTES, SECONDS, HOURS).
  - `amount` follows the number rule, and `spoken` is the full number ("2,450,000 steps") for VoiceOver.
  - `art`: `peak` for reps, `pin` for routes, `bird` for sleep and `moon` for plank or time. The app owns colours and drawings: blue peak, red pin, purple godwit, green moon and boot.
- `postmark: { day: "OCT 1", year: "2026", verb: "CLIMBED" }`. The day comes from `award.on` (a local day key, so no time zone is involved).
  - The verb is CLIMBED (height), WALKED or RAN (route), SLEPT (sleep), and PLANKED or DONE (time).
- One helper, `stampAmount(n)`, writes every compressed count, so a number on the card and the stamp never disagree.

The bank change: each `ladder` time entry used for plank or sleep (59 entries) gets `place` (at most 28 characters) and `as`. A test fails if a ladder entry lacks either. A second test runs `shareCard` over every selectable bank entry (ladder or searched), every registered activity, a 40-letter custom activity, an opaque one and a found entry, and checks the limits and the strict schema.

### 3. Zones and the prompt

There is one exported constant, `SHARE_ZONES`, in fractions of the 1024×1536 frame:

```ts
export const SHARE_ZONES = {
  words: { x: 0, y: 0, w: 0.5, h: 0.30 },     // place + line
  marks: { x: 0.5, y: 0, w: 0.5, h: 0.30 },   // stamp + postmark
  wordmark: { x: 0.75, y: 0.92, w: 0.25, h: 0.08 },
  person: { y: 0.32, h: 0.60 },               // whole person and face
} as const;
```

`framing` loses its 3:4 crop and quiet-space sentences. A `Layout:` paragraph built from `SHARE_ZONES` says:
- The top 30% is plain sky or background.
- The bottom-right corner is plain.
- The whole person, face included, is between 32% and 92% from the top.

The share view gains `zones: SHARE_ZONES`. The app reads `marks` and `words` for the face check, so the prompt and the app share one source.

### 4. The medal photo

Storage: a new table, `game_progress_share_photo`, owns every copy. It has `storage_key` (the primary key), `member_id`, `status` (`pending`, `current` or `retired`) and `created_at`. There is no profile column.
- Keys use the existing Progress grammar, `progress/<32 hex>.jpg`, so the Worker boundary, reads and purges need no change.
- The bytes are sealed like a made picture, with their own AAD: `table: 'game_progress_share_photo', rowId: <key>, field: 'bytes'`.
- Rows are never deleted while the member exists. A retired row keeps its key, so a failed purge replays on the next Turn off or on account deletion, as share rows do.
- Why a copy and not a game media key: game media is content-addressed and shared with posts and the profile photo, with no single-key delete, so "Turn off deletes your photo" could not be true. A copy also survives the post being withdrawn.

`PUT /api/game/v1/progress/share-photo` takes one of three bodies:
- `{ "from": "profile" }`: the member's profile photo.
- `{ "from": "post", "entryId": "…" }`: the member's own photo check-in, not withdrawn. The server reads its first media key.
- A raw `image/jpeg` body of at most `GAME_MEDIA_MAX_BYTES` (Take one, From Photos).

The server:
1. Reads the bytes outside any transaction. For profile and post it uses `readGameMedia` with a key it resolved itself, so no client key is trusted.
2. Runs `prepareShareJpeg` once: orient, strip metadata, at most 2 MB.
3. Under the member lock, with consent `allowed`, inserts a `pending` row with a fresh key. Ownership exists before the store write, as `putProgressPic` does.
4. Seals and stores the bytes.
5. Under the member lock, with consent still `allowed` and the row still `pending`, retires every other live row of the member and marks this one `current`.
6. After commit, purges the retired keys.

If any step after 3 fails, the request retires its own row and purges its key. If the process dies, the `pending` row still owns the key, so Turn off and account deletion purge it.

`GET /api/game/v1/progress/share-photo` returns the current JPEG for the Settings row and the step's preselection: private, no-store, and 404 when there's none. It rechecks consent and that the row is still `current` after decrypting, as `readProgressShareImage` does.

Use:
- `readSelection` reads the `current` row instead of the profile `photoKey`. `needs_photo` means no current row.
- `startProgressShare` opens the sealed copy. It's already prepared, so start runs no `sharp` and no game media read. Admission still checks that the current key is the one it read.
- A missing or unreadable copy is a 503, as a missing game media object is today. Start never clears the selection: a current copy is only purged after a later pick or Turn off has retired it, so a miss is store loss, not a race.
- The profile-photo read path in shares.ts is deleted.

Delete:
- `decideProgressShareConsent('deny')`, the one owner of turning pictures off (app and web Privacy), retires every photo row in its transaction and purges every photo key with the retired shares.
- Account deletion purges every photo key before member cascades, next to `deleteProgressSharesForAccount`. The coverage inventory gets a `prisma.game_progress_share_photo` entry.
- The account export adds the current photo's JPEG, next to the made pictures.

Existing members: nobody has a medal photo yet, so each member's next picture asks once, with their profile photo preselected. There is no backfill.

### 4b. Change photo makes a new attempt

Paper's ready state keeps Change photo ("Change photo still swaps it for this picture"), so an award can have more than one attempt.
- `game_progress_share` keeps one row per attempt. Its primary key moves from `(member_id, award_lookup)` to `storage_key`, which is already unique and is the attempt's identity. A new index on `(member_id, award_lookup, created_at)` serves the reads.
- What shows: the newest attempt, unless it failed or ran out of time and an older `ready` one exists. Then the older picture still shows, so a failed Change photo never loses the picture.
- The photo presentation gains `attempt` (the attempt's created-at in base 36), so the app's image cache and face check see a new picture as new. `imagePath` stays as it is: build 118 refuses a share image path with a query string. It also gains `availableAt` when the quota would refuse Change photo right now, so the app says "Back at 5:09 PM" instead of trying.
- `POST /shares/:id` takes an optional body `{ "replaces": "<attempt>" }`. Under the member lock it admits a new attempt only if the shown picture is that attempt, nothing for the award is generating, and the quota allows. Otherwise it returns the current view. A retry after a lost response finds the new attempt generating and returns it, so it never dispatches twice. An empty body keeps today's first-start behavior.
- Generation addresses its own row by `storage_key`: the liveness checks, publish and failure all match that key, so an older attempt can never publish or fail a newer one.
- Publish marks the new attempt `ready` and retires the award's other `ready` attempts in the same transaction, then purges their keys after commit.
- Every attempt row stays, so all count toward 5 a day and 30 in 30 days, and cleanup and export see all keys.

### 5. Contract and deploy skew

- The share view's `card` gains `place`, `line`, `stamp` and `postmark`, and the view gains `zones`. These are new strict-schema fields on the server; build 118 ignores them.
- New route: `share-photo` (PUT, GET).
- The migration is predeploy and old-code safe: a new table, a new index, and the primary key swap. The live code reads and writes share rows by column (`findUnique` by member and award is a plain `WHERE`), and a second attempt per award can only come from build 119's Change photo, which ships after this server, so the old code never sees two.
- Build 118 after the server ships:
  - Pictures already made still show.
  - A member with no medal photo gets `needs_photo`. Build 118's "Add a photo" sets the profile photo, and the view stays `needs_photo`, so 118 can't start new medal pictures until 119. That follows the owner's no-old-build-compat rule. The only 118 users are the team, and 119 follows straight after.
- Order: #5180, then the server PR, both deployed. Then the iOS PR, then build 119.

### 6. iOS

- `GameMedalPostcard` replaces the full-bleed photo card, the medal card and the ask card in `GameProgressShareCard.swift`. It's one card view with a `side` (medal or picture) and a `layout` (standard or mirrored).
  - Sizes are shares of the card width: stamp 36% / 28%, postmark 25% / 21%. Each side has one size rule, so the SE, the Pro Max and the Duo scale the same way.
  - The picture inset is card width minus 20, at 2:3.
- `GameStamp` draws:
  - a perforated edge, a frame and MURPH at the top;
  - the art;
  - `amount` in Fraunces bold and `unit` in DM Mono.
  The 4 arts are drawn in SwiftUI shapes, so no assets are needed.
- `GamePostmark`: a ring with curved text, "MURPH · {verb}" on the top arc and the year on the bottom arc, and the day between two rules.
- Button row: one `HStack` per state, as listed in the Goal, with the same height in every state, so nothing jumps.
  - At Bold Text xLarge, buttons are 60 pt with 19 pt bold labels, and on the 17 Pro Put me there takes its own row.
- Which photo step:
  - It slides inside the same drawer at the same height.
  - The grid has 3 columns:
    - the profile photo, if any;
    - up to 3 of the member's most recent photo check-ins that the app has loaded, newest first;
    - Take one, using the existing `GameProgressCamera`;
    - From Photos.
  - Put me there sends `PUT share-photo` and then `POST` start.
  - The step shows when the view is `needs_photo`, and from Settings › Change and the ready side's Change photo.
- Making: a veil over the drawing, the existing timed pill, and Send in Messages disabled.
- Face check:
  - Once, when the picture arrives, `VNDetectFaceRectanglesRequest` runs on the decoded image.
  - If any face box, padded 10%, intersects `zones.marks`, the layout is `mirrored`: marks top left, and the place and line bottom left over a soft bottom shade.
  - The result is kept with the picture in the store, so a reopened drawer doesn't run it again.
  - `GameProgressShareCard.render` draws the same layout into the PNG.
- Settings › Pictures of you:
  - A "Your photo" row with the `GET share-photo` thumbnail and Change.
  - The copy becomes "When you open something you passed, Murph sends your photo to make a picture of you. Turning this off deletes the pictures made and your photo."
- Duo:
  - Closed: the card is 361×542 and the row narrows to match.
  - Open: the postcard sits left at 390 and the photo step on the right.
- Dark mode: the card stays paper, with the light palette forced inside the card only.
- Map pill: "Painting the map NN%" picks the bottom corner with no town mark under it.
- Decoding: `Card` requires `place`, `line`, `stamp` and `postmark`, and the view requires `zones`. Fixtures are updated in the same PR, and there is one renderer for the screen and the PNG.
- Change photo: the step, then `PUT share-photo`, then `POST` with `{ replaces }` set to the shown `attempt`. With `availableAt` on the photo state, the button reads "Back at 5:09 PM" instead.

## Failure modes

- **The model ignores the zones and a face lands under the marks.** The app mirrors the layout, with no retry and no extra cost. If faces touch both top corners (a very close crop), the default layout stays, as Paper's Zones board says.
- **The medal photo's copy is gone** (store loss). Start returns 503 and spends nothing. A new pick replaces it.
- **A purge fails** after a pick or a Turn off. The retired row keeps the key, and the next Turn off or account deletion purges it again.
- **A pick races a Turn off.** Both lock the member row. Turn off retires every photo row and purges every key. A PUT whose swap runs after the deny finds its row retired, so it fails and its key is already owned and purged.
- **A pick races a start.** Start reads the current key, opens it outside the transaction, then admits only if that key is still current. If a pick retired it first, start returns a retryable 503 and spends nothing, as today.
- **Change photo fails.** The new attempt is `failed`, and the older `ready` picture shows again.
- **Change photo is retried after a lost response.** The award has an attempt generating, so the retry returns that view.
- **The quota is hit.** The view is `later` with `availableAt`, and no 429 reaches the drawer.
- **A long place name** ("The International Space Station", 31 characters) wraps to two lines and never shrinks. The line stays at 32 characters or fewer by test.
- **The bytes body is not a JPEG, or too big.** 415 or 413 before any store write.

## Tests

Server (vitest, with the Postgres-backed share tests where they exist):
- `stampAmount` table: 0, 3, 9, 1,210, 15,766, 99,999, 100,000, 125,000, 999,999, 1,000,000, 2,450,000, 9,999,999 and 10,000,000.
- Every ladder height entry × each rep exercise, every plank and sleep ladder time entry, and a sample of route legs:
  - `line` is at most 32 characters;
  - `unit` is at most 16;
  - `place` is not empty;
  - no em dash appears.
- Prompt: has the Layout paragraph from `SHARE_ZONES`, and has no "3:4" and no "quiet space".
- share-photo PUT:
  - profile, own post and raw bytes are each accepted;
  - another member's entry, a withdrawn entry, a non-photo entry, consent denied and an oversize body are rejected;
  - a second pick retires and purges the first copy;
  - a failed purge leaves the retired row, and the next Turn off purges it;
  - a store failure retires the request's own row.
- Start: with no medal photo the view is `needs_photo`. With one, it never calls `readGameMedia` or `prepareShareJpeg`. A pick between the read and admission spends nothing.
- Change photo (Postgres): one replacement from a ready attempt; a repeated `replaces` dispatches nothing; a failed replacement shows the old picture; a stale attempt cannot publish over a newer one; every attempt counts toward the quota; deny purges every attempt key.
- Deny: retires every photo row, purges every photo key and still retires the made pictures.

iOS:
- Unit tests:
  - card decoding with and without the new fields;
  - the face-check mirror decision, from synthetic face boxes against `zones.marks`;
  - stamp and postmark size shares;
  - button-row state mapping, including `later`.
- UI evidence (`GameScreensProgressShareUITests`) on the SE, 17 Pro and Pro Max (Bold Text xLarge), plus the Duo, covering every state on the Flow board, the photo step with and without photos, Settings, dark mode, and the mirrored layout.
- The full `MurphCompanionTests` target before the gate.

## Rollout

1. Rebase #5180, run ReviewGPT, merge, deploy.
2. Server PR (sections 2 to 5): ReviewGPT (sensitive: private photos), merge, then confirm the deploy and the migration.
3. iOS PR, with UI evidence, then merge.
4. Build 119 through the release gate.

## ReviewGPT outcomes

Plan review on 2026-11-19 (mountain lane, `audit-packages/plan-medal-postcard.md`), seven findings:

1. **P1, durable ownership of every photo copy: accepted.** The single profile column lost keys after a failed purge, a failed Turn off purge, or a crash between upload and swap. Replaced by the `game_progress_share_photo` table with `pending`, `current` and `retired` rows, written before the store write, as `putProgressPic` does (section 4).
2. **P1, Change photo on a made postcard: accepted.** `startProgressShare` returns early when any row exists and the key was `(member, award)`, so Change photo would have returned the old picture. Paper keeps the button, so attempts are now rows keyed by `storage_key`, with `replaces` on POST and an `attempt` on the photo state (section 4b). The version is not a query on `imagePath`, because build 118's `isProgressImagePath` refuses a share path with a query.
3. **P1, the `photo-` key subtype: accepted.** `requireHostedProgressPicId` only accepts `progress/<32 hex>.jpg`. Photo copies use that grammar.
4. **P2, the unconditional clear on a missing copy: accepted by deleting it.** With durable ownership, a current copy is only purged after it's retired, so the recovery path has nothing to recover. A miss is a 503, and start's existing "key still current" admission check covers the race.
5. **P2, canonical route names: rejected.** The route's name everywhere it shows today (the Steps page, today's share card, the poster pill) is the saved `from` and `to`. Showing different words on the postcard would make it disagree with the page it opens from, and capturing new geocoded labels would mean a new field on frozen awards for every old medal. The postcard takes the text before the first comma of each saved end. Labels at the route boundary can come later for every surface at once.
6. **P2, a projection for every accepted entry: accepted.** The time bank has 32 searched entries outside the ladders, and custom activities are unbounded. `shareCard` now falls back to the entry's `short` or name, a plain line per kind, and plain units, and one test runs every selectable entry and activity (section 2).
7. **P2, the fixture-only legacy renderer: accepted.** iOS requires the new fields and fixtures are updated in the same PR (section 6).
