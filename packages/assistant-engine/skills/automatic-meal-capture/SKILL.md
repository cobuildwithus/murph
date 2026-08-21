---
name: automatic-meal-capture
description: Use for Murph iPhone automatic meal capture setup, Photos permissions, background behavior, the on-device Meals review page, missing or delayed imports, the automatic 9pm closeout, retained-photo cleanup, and calorie-aware enrichment of automatically captured meal photos.
---

# Automatic meal capture

## Own the automatic-capture boundary

Use this skill when a member asks how automatic meal capture works, needs the
iPhone app, is setting it up, says a photo did not arrive, asks what Murph can
see, or wants device-captured meal photos included in calorie or macro tracking.

Automatic capture already creates a canonical photo-only meal. This skill owns
the iPhone setup and arrival-verification workflow; it does not create a second
meal store or a duplicate meal record. Read
`$MURPH_ASSISTANT_SKILLS_ROOT/food-journal/SKILL.md` before estimating nutrition
or interpreting meal patterns. A successful automatic import ensures one
private 9pm managed closeout for that member; there is no separate automation
opt-in. Load this skill alongside `food-journal` on every eligible interactive
meal turn and check recent unresolved device meals. Use `nutrition-strategy` for
forward-looking decisions about what to eat.

## Set up the iPhone app

Use the shortest relevant setup path:

1. Automatic meal capture requires an iPhone on iOS 26.1 or later.
2. Download or open Murph from
   `https://apps.apple.com/us/app/murph-ai/id6786145859` and sign in to the same
   Murph account used in the conversation. The automatic closeout needs an
   existing private iMessage or Telegram conversation, or a verified email
   address; this is a delivery prerequisite, not a second automation opt-in.
   Follow the developer prompt's URL placement rule when sending the link.
3. In Murph, open the menu, open Settings, choose Meal capture, and choose Set
   up. If Meal capture is absent after updating, the installed build does not
   support it; do not send the member through a setup retry loop.
4. Continue through Murph's explanation and grant **Full Photos** access in
   Apple's system prompt. Limited Photos access is not enough.
5. Confirm the Settings row says On. Only photos inserted after successful
   enablement are eligible; existing photos are never scanned.

Do not claim Android support, ask the member to choose historical photos, or
invent a second background permission. The app enables its PhotoKit background
adapter during setup.

## Explain what happens

- Murph considers only new image insertions after opt-in.
- The iPhone renders a bounded, metadata-sanitized JPEG and runs Apple's Vision
  classifier on device.
- Likely meals upload automatically. Uncertain candidates stay in the iPhone's
  bounded recent Meals list unless the member chooses Approve & send. They may
  age out after 14 days or as newer items fill the 24-item limit. Clear
  non-meals stay private and contribute only to an aggregate on-device count.
- Murph does not receive the original filename, location, camera metadata,
  Vision labels, or classifier confidence.
- A successful upload lands asynchronously as one canonical meal with the
  sanitized photo, `source: device`, and the photo's original capture time. It
  starts without identified foods, calories, or macros.
- The canonical import also ensures one managed daily closeout at 9:00pm in the
  vault timezone. Replayed and later captures reuse that automation.
- The original capture instant—not upload or import time—owns meal timing.
  Infer breakfast, lunch, dinner, and day context in the member's vault
  timezone. If travel or a timezone change could materially alter the answer,
  state the ambiguity or ask instead of asserting a category.

Background work is best effort. PhotoKit can wake the app's background task,
the app schedules another background opportunity, and opening Murph runs the
same catch-up processor immediately. iOS may delay or skip any background
opportunity. Do not promise immediate logging, guaranteed capture, or that the
member never needs to open the app. After a long idle period, the scoped upload
credential may require renewal by opening Murph.

Automatic capture does not itself require a chat reply and its import does not
start a model turn. If the member asks whether a photo arrived, verify the meal
record instead of using conversation silence as evidence of failure. Inspect and
enrich unresolved device meals on the next eligible interactive turn. The 9pm
closeout handles the same unresolved work independently. Do not claim enrichment
happened at import time.

## Verify an import

Use the canonical meal surface:

1. Query the local date covering the original photo time:

   `vault-cli meal list --from <YYYY-MM-DD> --to <YYYY-MM-DD> --limit 20 --format json`

   Include the adjacent date near midnight or when the member gives a capture
   time in another timezone.

2. Identify recent photo-backed device meals. Use
   `vault-cli meal show <meal-id> --format json` when the list result is not
   detailed enough or the attachment must be inspected.
3. Confirm arrival from a real returned meal id, photo attachment, and captured
   time. Report those facts plainly.

An iPhone Sent state means the upload was accepted; canonical import may still
be finishing. If a just-sent photo is absent on the first read, say it may still
be landing and perform one fresh canonical re-check. If it is still absent,
report the import as pending; do not request a resend solely from back-to-back
reads. Suggest resending only after later evidence shows the upload failed. Also
distinguish a pending import from a candidate that is still local in Review and
cannot yet be visible to Murph.

## Enrich calorie and macro tracking by default

Estimate calories and macros by default when enriching a captured meal. Skip
estimation only for intuitive-eating contexts, eating-disorder risk, or
number-sensitive members.

When enriching a captured meal:

1. List recent meals and find photo-backed device meals with missing nutrition.
2. Before editing, compare nearby canonical meals for a likely manual,
   conversation, provider, or second-photo record of the same eating occasion.
   Do not enrich both, sum both, delete, or merge silently; identify the
   probable duplicate and ask only when resolving it materially affects
   tracking.
3. Show each candidate and inspect its actual photo attachment. Do not infer
   foods from the fact that the on-device classifier accepted it.
4. Resolve exact visible package or menu labels with the food-journal label
   workflow when identity changes the estimate. Otherwise estimate visible
   ingredients and portions conservatively.
5. Enrich the existing meal with `vault-cli meal edit <meal-id>`, repeated
   `--ingredient` flags, relevant nutrition flags, evidence-dependent
   provenance, an honest confidence, and a short `--nutrition-source-detail`.
   Use `--nutrition-source label` for verified label facts,
   `--nutrition-source database` for matched database facts, and
   `--nutrition-source estimated` only for visual ingredient or portion
   estimates. For mixed evidence, describe both and set confidence from the
   weakest material assumption. Preserve the meal's occurred-at time and
   source. Keep the photo until saved structure has been read back.
6. Read the edited meal back before claiming it was logged.

Do not run `meal add` for a captured photo that already has a meal id. The
automatic import is the meal log; `meal edit` adds the useful structure. By
default, save a bounded photo estimate without asking for confirmation on every
meal, but the estimate must retain provenance and uncertainty. If the photo
cannot support a meaningful estimate, leave the photo-only meal intact and ask
one narrow portion or identity question only when the member is present and the
answer would materially help.

Do not surface calorie numbers for intuitive-eating contexts, eating-disorder
risk, or number-sensitive members.

## Run the automatic 9pm closeout

On a scheduled run:

1. Use the engine-supplied `Occurrence local date` from the `Scheduled
   occurrence context` as the action and latest-capture boundary, even when the
   wall-clock `Today's date` differs. Run `vault-cli meal closeout-work
   --occurrence-at <scheduled-occurrence-instant> --to
   <occurrence-local-date> --limit 20 --format json`. It returns
   same-occurrence retry evidence first, then the oldest bounded batch of
   automatic captures that still retain photos. Those photos are the queue,
   with no separate cursor or state.
2. Treat each retained photo as pending closeout work. Also include an
   automatic capture with no photo when its latest `recordedAt` is at or after
   this scheduled occurrence instant: that removal revision proves an earlier
   attempt of the same occurrence already cleaned it. `closeout-work` includes
   that evidence without carrying it into a later occurrence. Group captures
   by local capture date. A late import gets one dated catch-up.
3. Compare nearby meals before counting so a manual record or second photo of
   the same eating occasion is not silently double counted.
4. Run `vault-cli meal show <meal-id> --format json` for each selected meal and
   inspect the actual attachment for a photo-backed selection. For
   same-occurrence retry evidence, use only the already-saved structured fields
   and uncertainty. Enrich the existing meal when supported and read it back.
5. Run `vault-cli meal remove-photo <meal-id>` and read the meal back again.
   This automatic-capture-only command preserves the structured meal and
   replaces retained image bytes with a privacy tombstone. Any removal failure
   fails the run. On retry, combine photos that remain with same-occurrence
   removal revisions so a provider or partial-cleanup failure loses no meal.
6. After inspection, enrichment, read-back, and photo cleanup, first prove the
   active Goal read is complete. Run `vault-cli goal list --status active
   --limit 200 --format json`. If it returns 200 records, fail closed with the
   ordinary compact closeout: run no Goal detail reads, perform no Goal or
   measurement mutation, ask no question, and attach no card. Otherwise, run
   `vault-cli goal show <goal-id> --format json` for every returned active Goal
   whose list item reports a nonzero `data.metricTargetsCount`. Do not select
   detail reads by title, slug, domain, context-snapshot visibility, or the
   default list prefix. Resolve metric identity, unit, comparator, effective
   date, conflicts, and the 1,200-kcal boundary only after inspecting that
   complete detail set. This active-target authority read is separate from any
   all-status Goal lookup used to reuse or honor Murph's managed paused or
   abandoned proposal; never substitute that lookup here. Then read and apply
   `$MURPH_ASSISTANT_SKILLS_ROOT/nutrition-strategy/references/daily-nutrition-card-safety.md`
   before resolving a card, even when five accepted goals already exist. This
   first requires `vault-cli memory show --format json`; if that complete
   canonical memory read fails or is unreadable, keep the ordinary compact
   closeout, perform no Goal or measurement mutation, ask no question, and
   attach no card. A clearly current saved age under 18 or clearly current
   intuitive-eating or number-sensitive preference uses the same non-numeric,
   no-write, no-question, no-card path. Missing or ambiguous age alone does not
   block a scheduled closeout and never authorizes a question. The gate also
   requires both `vault-cli condition list --status active --limit 200 --format
   json` and `vault-cli regimen list --status active --limit 200 --format json`.
   If either returns exactly 200 records or fails, run no condition or regimen
   detail reads, keep the ordinary compact closeout, perform no Goal or
   measurement mutation, ask no question, and attach no card. Otherwise, run
   `vault-cli condition show <condition-id> --format json` for every returned
   condition and `vault-cli regimen show <regimen-id> --format json` for every
   returned regimen before applying the safety gate. Never use the five-record
   context projection, a title, substance, severity, or the default list prefix
   to select the safety set. If any required detail read fails, is explicitly
   truncated, or is unreadable, retry that exact id once through `vault-cli show
   <same-id> --format json`. Continue only when the fallback returns one complete,
   unambiguous canonical record; otherwise use the same ordinary-text, no-write,
   no-question, no-card failure behavior. Never omit fields, shrink the safety
   set, or retry indefinitely.
   Also run `vault-cli event list --kind procedure --limit 200 --format json`
   and follow the shared gate's procedure-item inspection and conditional detail
   reads. A completed bariatric procedure uses the same non-numeric,
   no-write, no-question, no-card path; failed, unreadable, or saturated
   procedure discovery uses the failure path. Also run `vault-cli event list
   --kind encounter --limit 200 --format json`, detail-read every returned item
   with nonzero `data.diagnosesCount`, and apply the shared gate's current active
   diagnosis rules. A relevant active documented or suspected diagnosis uses
   the same non-numeric path; failed, unreadable, saturated, required-detail,
   or unresolved safety-relevant diagnosis discovery uses the failure path.
   Then run the shared gate's bounded body-measurement read, separate
   `pregnancy-test` measurement read, and bounded canonical test-event list plus
   every required test detail read. A failed read, a body-measurement read
   saturated without resolving usable BMI evidence, or a saturated
   pregnancy-evidence read uses the same failure behavior. An explicit positive
   pregnancy-test result from either canonical owner
   uses the same non-numeric, no-write, no-question, no-card path. Reuse all
   complete gate reads for the current turn. If the active target bundle is
   incomplete after those reads, the first eligible managed closeout has one
   proposal-only exception. Read and follow
   `$MURPH_ASSISTANT_SKILLS_ROOT/nutrition-strategy/references/daily-nutrition-card-goals.md`,
   then run `vault-cli goal list --limit 200 --format json` and detail-read only
   candidate managed records. If that read fails, is unreadable, is saturated,
   or finds any Goal with slug `murph-daily-nutrition-starting-targets` in any
   status, do not create, change, or automatically repeat a numeric proposal.
   Keep the ordinary compact closeout and attach no card. The absence of that
   managed Goal is the first-run authority; add no flag or second state owner.
   When the complete lookup proves absence, the safety gate passed, compatible
   explicit targets are unambiguous, and already-known inputs prove one
   responsible five-target bundle, create that single canonical Goal as
   `paused`, with `window.startAt` equal to the selected capture/card local date.
   Read it back, then explain all five provisional values, their material facts
   and assumptions, and the effective date in ordinary text. Ask no question,
   attach no card, and never activate it on the scheduled turn. If responsible
   inputs are missing or the bundle is infeasible, write nothing and keep the
   ordinary closeout. Member correction, acceptance, or decline remains an
   interactive turn. If numeric presentation is suppressed, or the active
   target bundle is ambiguous, unit-incompatible, or comparator-incompatible,
   retain the ordinary compact closeout and do not attach a card. Keep the occurrence
   local date from step 1 only as the work and retry boundary. Resolve target
   applicability against the single selected card `localDate`: the capture date
   whose totals and card are being closed out, including a historical catch-up
   date. A target
   qualifies only when that card date is on or after the containing Goal's
   `window.startAt`, on or before its optional `window.targetAt`, and inside the
   target's optional inclusive `startAt`/`targetAt` interval. Ignore an
   out-of-window target for current authority and conflict resolution; never
   copy, expose, derive from, or mutate a Goal because of it. If fewer than five
   applicable targets remain, ask no question and use ordinary closeout text.
   New authoring uses `dietary-calories`. For the card's calorie slot only, an
   existing applicable active exact-point `calories` target in `kcal` is a
   read-only legacy alias when no `dietary-calories` owner exists. Require one
   legacy owner. When the canonical owner also exists, use it only if every
   legacy alias is an identical compatible point; any different value,
   incompatible alias, or multiple legacy-only owners is a conflict. Never
   rename or mutate a Goal just to repair this key. The other card-qualifying
   targets must use the exact canonical metric/unit pairs:
   `protein-grams`, `carbs-grams`, `fat-grams`, and `fiber-grams` with `g`.
   A target in another unit remains authoritative, but never compare, convert,
   or copy its raw value into this fixed-unit card; on a scheduled occurrence,
   ask no question and use ordinary closeout text. Never infer a target from
   this day's meal total or one wearable day. A card-qualifying target must also
   be an exact point: its selected-value comparator is `between` with identical
   numeric `value` and `highValue`. A one-sided `<`, `<=`, `>`, or `>=`
   threshold, non-identical range, or other shape remains authoritative but is
   incompatible with this point-target card. Never expose, compare, copy, or
   derive from its bound, and never create, replace, or remove a managed target
   around it. On a scheduled occurrence, ask no question, perform no Goal or
   measurement mutation, and use ordinary closeout text without a card.
7. Only when all five qualifying exact point targets resolve from active
   canonical Goals, run the exact canonical
   `vault-cli meal totals --from <date> --to <date>` read for the selected date
   range immediately before any response-card attachment; do not reuse an
   earlier total or calculate nutrition independently. When the run covers
   exactly one local date, the canonical read includes a calorie total, and
   the card-time safety gate from step 6 still passes, call
   `murph.attach_response_card` with this exact mapping:
   `card: { kind: "daily_nutrition", version: 2, localDate: <the single
   selected date>, mealCount: <top-level mealCount>, totals: { calories,
   proteinGrams, carbsGrams, fatGrams, fiberGrams }, goals: { calories,
   proteinGrams, carbsGrams, fatGrams, fiberGrams } }`. Copy every metric's
   complete `{ total, mealCount }` pair unchanged from the canonical read,
   including `fiberGrams`. Each goal entry is
   `{ target: <exact canonical daily target>, status: <assessment> }`. Never
   translate a threshold or range comparator into this point-target payload.
   The assessment must be one of `far_under_target`, `under_target`, `on_target`,
   `over_target`, `far_over_target`, or `unavailable`. A metric whose total is
   missing or whose `mealCount` is below the top-level `mealCount` must use
   `unavailable`; do not color an incomplete total as under, on, or over target.
   Use the member's explicit tolerance or intensity when present. Otherwise
   make a forgiving, context-aware assessment: broadly aligned is `on_target`,
   a modest miss is `under_target` or `over_target`, and only a clearly material
   miss is `far_under_target` or `far_over_target`. There is no universal
   percentage threshold. After the tool succeeds, return a `send_message`
   decision without repeating nutrition values in its text; the runtime
   replaces that text with the deterministic closeout derived from the card.
   Do not author a second nutrition summary. The runtime labels partial totals
   as partial and identifies missing or under-supported nutrition honestly. For
   multi-date catch-up, missing calories, an incomplete or conflicting active
   target bundle, or numerical suppression, retain the current compact text,
   one-question, or non-numeric behavior and do not attach a card. Never attach
   the photos. Suppress the message only when neither a retained photo nor a
   same-occurrence removal revision is selected.

## Handle edge cases

- **Uncertain photo:** it exists only in the iPhone's bounded recent Meals list
  unless approved, and can age out after 14 days or once newer items fill the
  24-item limit. Murph cannot inspect or log it remotely before approval.
- **Old photo:** photos from before successful enablement are intentionally
  ignored, even if edited or re-opened later.
- **Limited or revoked Photos access:** capture pauses or stays off; direct the
  member to iOS Settings and require Full Photos access.
- **iCloud-backed photo:** iOS may download it locally before classification,
  causing delay or failure. Murph does not connect directly to iCloud.
- **Screenshot or non-image:** it is rejected before upload.
- **Deleted or unavailable asset:** a local review item may lose its thumbnail
  or become unsendable; do not claim the server has a recoverable copy.
- **Low light, mixed plates, packaging, or food-like objects:** classification
  and portion estimates can be wrong. Use the actual photo and retain
  uncertainty.
- **Several photos of one meal:** they can become separate meal records. Do not
  silently sum, delete, or merge them; identify the likely duplicate and ask
  only if it would materially change tracking.
- **App says Sent but the assistant did not mention it:** conversation silence
  is normal. Query meals by captured time.
- **Setup loops or errors:** confirm supported iOS, the current App Store app,
  the same Murph account, network access, and Full Photos permission. Avoid
  repeated blind retries; if one fresh setup attempt still fails, state the
  unresolved step rather than claiming capture is on.
