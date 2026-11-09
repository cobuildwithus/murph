# Skip an automatic meal photo Murph already logged from a message

Status: active
Created: 2026-11-09
Updated: 2026-11-09

## Goal

A member texts Murph a meal photo (iMessage, Telegram or email) and Murph logs
it. The same photo is in the phone's library, either taken with the Messages
camera or sent from Photos. The iPhone's automatic meal capture later
classifies it as food and uploads it. Today the runtime imports that upload as a
second, photo-only meal. The member then sees the meal twice: on the Meals page,
in totals, and in closeout questions. The only safeguard is the model-run
merge/delete rule in the `automatic-meal-capture` skill, and it runs later.

Outcome: when an automatic capture's photo is the same photo as one already on
a meal Murph saved from a message, the runtime creates no new meal. It links the
upload to that meal (`uploadId`), so the iPhone pairs its sent photo with the
existing meal instead of showing it as a separate unlogged photo.

## Cause (proved from code)

- `packages/assistant-runtime/src/hosted-runtime/meal-photo-import.ts` dedupes
  only by the capture's own `externalRef` (capture id), then calls `addMeal`.
- The iPhone's `MealPhotoDuplicatePolicy` compares a candidate only with the
  phone's own recent captures (review items within 5 minutes). It never sees
  photos Murph received over a message.
- A chat-logged meal (`vault-cli meal add --photo`) has no `uploadId` and no
  `externalRef`. Its `photoCapturedAt` is the time Murph saved it.

## Design

One core function, called by the runtime import for automatic captures only:

`linkUploadToMealWithSamePhoto({ vaultRoot, uploadId, capturedAt, jpeg, materialize })`
returns the matched meal id or null. It lives in
`packages/core/src/domains/events/`, beside meal-photo maintenance, and reuses
that module's latest-meal traversal.

1. Collapse the latest revision of every meal across all event shards (the
   maintenance traversal). Shards are keyed by `occurredAt`, which can differ
   from the photo time, so no month shortcut is taken.
2. If a live meal already has `uploadId === uploadId`, return it. This makes a
   retried import idempotent.
3. Candidates are live meals that meet all of these:
   - no `uploadId`;
   - no `meal-photo-capture` `externalRef`;
   - a `photo_thumbnail` or `photo` attachment (thumbnail preferred);
   - `photoCapturedAt` in `[capturedAt − 10 min, capturedAt + 24 h]`.

   A chat meal's `photoCapturedAt` is when Murph saved it, which is after the
   photo was taken, so this keeps yesterday's similar breakfast out. Check the
   8 newest. Both the window and the cap are recall tradeoffs: a miss falls back
   to today's behavior.
4. For each candidate, `materialize(relativePath)` returns true when the bytes
   are local, false when they're definitively unavailable (skip), or throws
   (retry). This mirrors maintenance's `materializeCandidatePaths` seam. Core
   then reads the file through vault-safe path resolution and skips it if
   `sha256` doesn't match or it fails to decode. Decoding sets a pixel limit.
5. Same photo means: after EXIF orientation, both images are resized to 32×32
   grayscale and each is normalized to zero mean and unit variance. In each of
   the 64 4×4 blocks, the mean absolute difference must be ≤ 0.12. A flat image
   (standard deviation < 1) never matches. Every region has to agree, so a
   different item in one part of the frame breaks the match. Measured with
   sharp on sample photos (worst block):
   - Re-encoded q30–q50, resized to 320/640/1200 px, `sips` q40, gamma
     0.8/1.25, saturation ×1.3 or a warm tint: ≤ 0.091.
   - +10% brightness with clipping: 0.14, a miss we accept.
   - A 1% reframe: 0.135. A 2% reframe: 0.238. A 2° rotation: 0.736.
   - Same surroundings with a different centre covering 1% / 2.25% / 9% of the
     frame: 0.198 / 0.404 / 1.61.
   - Different photos: ≥ 2.1.

   Whole-image Pearson correlation was rejected: a 2.25%-area centre swap scored
   0.993 and would have matched.
6. On a match, write one revision of the full latest meal, setting `uploadId`
   and a fresh `recordedAt`, with `upsertEvent`
   (`allowSpecializedKindRewrite`, `expectedRevision` = the current revision).
   This is the same writer the meal edit path uses. Matching happens outside
   the write lock, and the locked revision check rejects a stale match.

In `importHostedMealPhotoCapturedMailboxItem`, for non-manual wakes only, call
it after the staged bytes pass integrity validation and before `addMeal`:

- A meal id: no meal is created, and the existing idempotent closeout ensure
  still runs, so a member's first upload still activates the 9 p.m. closeout.
  The result is `imported` with reason `meal_photo.already_logged` and the
  existing staged-photo cleanup effect.
- Null continues to today's path unchanged.
- A ledger read failure, a materializer throw, a `transport` unavailability or
  a link-write failure is `blocked`, retryable
  (`meal_photo.already_logged_check_failed`). Once a match may exist, a
  duplicate is never written.

The runtime passes the invocation's restored workspace materializer through the
existing mailbox import context (`HostedWorkspaceRuntimeJobImportContext`), set
in `createMailboxImportContext`. The adapter calls it with
`vault:<path>`, a per-file and total byte cap, and the invocation signal. It
maps the result: materialized → true; `transport` → throw; any other reason →
false. A missing materializer (a local or test runtime) reads from disk as-is.

The iPhone needs no change. The meals projection already exposes `uploadId`
(`packages/query/src/browser-replica/meals.ts`), and `GameSentMealPhoto.match`
pairs a sent capture to a meal by it. Pairing appears after the next ordinary
snapshot publication. Until then the phone shows its sent photo as unlogged
(at most its existing two-hour window), as it does today for any upload still
landing.

## Scope

- In scope:
  - the core function and its tests;
  - the runtime import branch and its test;
  - the ARCHITECTURE.md § Meal-photo capture sentence;
  - the materializer handoff through the mailbox import context.
- Out of scope:
  - manual app sends (`meal-photo:manual:*`). The member's explicit send keeps
    today's behavior.
  - The reverse order (capture imported first, chat photo second); the skill's
    merge rule still owns it.
  - Device-to-device duplicates; the iPhone policy owns those.
  - Any iOS or contract change.
  - Assistant skill text (see review disposition 8).

## Constraints

- Technical constraints:
  - The runtime only. No contract, schema, or web change, so there's no deploy
    skew.
  - sharp comes in through core's existing dynamic import. Prebuilt sharp has
    no HEIC decoder; HEIC candidates skip (fail open).
  - Raw files may be deferred in the hosted workspace. Read them through the
    restored workspace materializer from the import context.
  - The work is bounded: at most 8 small decodes per automatic capture.
- Product/process constraints:
  - Prefer missing a duplicate over dropping a different meal, as the iPhone
    policy already does.

## Risks and mitigations

1. Risk: a different photo is treated as the same one and dropped.
   Mitigation:
   - every 4×4 block must agree, so a different item covering about 1% of the
     frame or more already fails;
   - a second handheld shot (2% reframe or more) fails;
   - only chat-logged meals saved after the capture are candidates;
   - the upload stays linked and visible on that meal.
2. Risk: the chat meal isn't saved yet when the capture imports.
   Mitigation: none needed. That falls through to today's behavior, with the
   skill's merge rule as backstop.
3. Risk: a deferred raw file can't be materialized.
   Mitigation: skip that candidate (fail open).
4. Risk: a retry after a crash between the link write and the checkpoint.
   Mitigation: step 2 finds the linked meal by `uploadId`, and the closeout
   ensure runs again.
6. Risk: rollback or deploy skew. A runtime older than this change, replaying
   an item whose link was written but not checkpointed, creates the photo-only
   meal as it does today.
   Mitigation: none needed. That is today's duplicate, and the skill's merge
   rule still applies. No schema or contract changes, so nothing else skews.
5. Risk: the linked `uploadId` changes how the app shows a chat meal.
   Mitigation: the card shows the phone's own copy of the same photo. That is
   the intended pairing.

## Alternatives rejected

- Check on the iPhone. The background processor runs with an upload-only
  credential, and Murph's chat-photo thumbnails reach the app only after idle
  maintenance. It would couple capture to the member session and race thumbnail
  creation.
- Store a perceptual print on every meal at write time. That adds a canonical
  schema field, deploy skew, and a backfill question.
- Match on EXIF capture time. The vault keeps no EXIF (sharp strips it, and
  there is no reader), and message delivery may drop it.

## Review dispositions (independent Codex plan review, 2026-11-09)

ReviewGPT lanes are rate-limited until Nov 10–11, so the plan was reviewed by a
read-only Codex deep review.

1. Month-limited scan misses meals. **Accepted**: scan all shards via the
   maintenance traversal.
2. The integration-ingest scope doesn't materialize meal photos. **Accepted**:
   pass the restored artifact materializer through the import context.
3. Separate a transient failure from an unavailable file. **Accepted**:
   `transport` or a throw retries; other reasons skip.
4. A match must keep the closeout postcondition. **Accepted**: the ensure still
   runs on the matched path.
5. Write the full record with `upsertEvent`. **Accepted** (step 6).
6. Stronger image evidence and a flat-image rule. **Accepted**: switched from
   whole-image correlation to every-block agreement after a 2.25% centre swap
   matched; added a flat-image rule and a pixel limit; the window and cap are
   documented as recall tradeoffs. A SHA precheck was **rejected**: the phone
   always re-encodes, so it never fires.
7. Deploy skew and delayed pairing. **Accepted** as documentation (risk 6 and
   the Design pairing note); no machinery.
8. Update the skill's arrival verification and add an assistant journey.
   **Rejected** for this change. The linked meal is the photo the member texted
   and Murph already confirmed in that conversation. The skill's arrival check
   asks about uploads still landing, and it stays correct for every
   non-duplicate upload. A prompt change would require a live-model
   verification lane, which is out of proportion for this edge. Revisit if a
   member asks whether a texted photo also uploaded.

## Tasks

1. Core: the `linkUploadToMealWithSamePhoto` print, candidate read and link
   write, with unit tests:
   - re-encoded and resized variants match;
   - a different image misses;
   - the window bounds hold;
   - excluded sources (a meal with an `uploadId`, a device capture) are skipped;
   - a retry is idempotent;
   - an unreadable candidate is skipped.
2. Runtime: the automatic-only branch and its outcome; extend
   `hosted-runtime-meal-photo-import.test.ts`:
   - match → no new meal, `uploadId` linked, cleanup effect;
   - a manual wake is unchanged;
   - a link-write conflict → blocked, retryable.
3. Docs: ARCHITECTURE.md § Meal-photo capture.
4. Verify, review, PR, merge, deploy per the completion workflow.

## Decisions

- The runtime owns the check, because the vault is where both photos and the
  "already logged" fact live.
- The match is image-based, not time-only. A second meal photographed minutes
  later must still be logged.

## Verification

- Commands to run:
  - focused core and assistant-runtime vitest files;
  - `pnpm typecheck` for the touched packages;
  - the repo's required lint and drift checks per `verification-and-runtime.md`.
- Expected outcomes:
  - the new tests pass and the existing meal-photo-import tests pass unchanged;
  - no contract or web diff.
