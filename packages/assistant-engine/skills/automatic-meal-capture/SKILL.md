---
name: automatic-meal-capture
description: Use in a private direct conversation when someone asks how to start recurring meal tracking or how Murph can track meals, and whenever someone explicitly asks about Murph iPhone automatic meal capture setup, Photos permissions, background behavior, the on-device Meals review page, missing or delayed imports, the automatic 9pm closeout, retained-photo cleanup, or calorie-aware enrichment of automatically captured meal photos.
---

# Automatic meal capture

## Own the automatic-capture boundary

In a private direct conversation, load this skill when a member asks how to
start recurring meal tracking or how Murph can track meals, even when they do
not say "automatic." In any conversation, also use it when a member explicitly
asks how automatic meal capture works, needs the iPhone app for that feature,
is setting it up, says a photo did not arrive, asks what Murph can see, or wants
device-captured meal photos included in calorie or macro tracking. Do not treat
a generic group request, a request to continue an established manual workflow,
or already-completed setup as a fresh app-install request.

Automatic capture already creates a canonical photo-only meal. This skill owns
the iPhone setup and arrival-verification workflow; it does not create a second
meal store or a duplicate meal record. Read
`$MURPH_ASSISTANT_SKILLS_ROOT/food-journal/SKILL.md` before estimating nutrition
or interpreting meal patterns. A successful automatic import ensures one
private 9pm managed closeout for that member; there is no separate automation
opt-in. Load this skill alongside `food-journal` on eligible interactive
automatic-capture turns and check recent unresolved device meals. Use
`nutrition-strategy` for forward-looking decisions about what to eat.

## Answer a general recurring meal-tracking request

For a private direct request about starting recurring meal tracking, use known
context before choosing the first option:

- When device compatibility is unknown or a compatible iPhone is established,
  no manual-only preference is established, and setup is not already complete,
  lead with automatic capture as the lowest-friction supported option. Briefly
  explain that the member can download or open the Murph iPhone app, enable Meal
  capture, and have eligible new food photos picked up without messaging each
  meal. Include the canonical App Store listing and the shortest relevant setup
  steps below in the first answer.
- When known context establishes Android or another incompatible device, or the
  member prefers manual capture, lead with the food-journal skill's manual text,
  voice-note, and user-sent-photo options. Do not push the iPhone app or repeat
  automatic setup unless the member asks about it.
- When automatic meal capture is already enabled, explain the current capture,
  review, or recovery path that answers the question. Do not tell the member to
  download the app again or repeat completed setup steps.

When automatic capture leads, keep manual text, voice-note, and user-sent-photo
logging available as an alternative in the same answer. Do not assume the
member has a compatible iPhone, make the app a prerequisite for all meal
tracking, or promise that iOS background work will capture every meal. If
device compatibility is unknown, state the compatible-iPhone condition rather
than delaying the useful handoff with a question.

In a group, do not introduce the app or personalized automatic-capture setup for
a generic meal-tracking request. Share the canonical public App Store listing
only when someone explicitly asks how to get, download, or install the app, and
keep sign-in, permissions, and personalized health setup in the person's
private Murph conversation or in the app.

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
6. If the edit fails or the read-back does not prove the intended structure,
   run one fresh bounded meal list for the capture date, re-identify the exact
   photo-backed device meal from its returned id, source, occurred-at time, and
   attachment, inspect it, and retry `meal edit` once with corrected arguments.
   Never switch to `meal add`, guess a nearby record, or retry past that one
   correction. If the retry or its read-back fails, keep the photo and report or
   fail the unresolved work instead of claiming enrichment.
7. Read the edited meal back before claiming it was logged.

Do not run `meal add` for a captured photo that already has a meal id. The
automatic import is the meal log; `meal edit` adds the useful structure. By
default, save a bounded photo estimate without asking for confirmation on every
meal. Retain provenance, uncertainty, and assumptions; a visible food or drink
category with a defensible portion range is enough even when the exact recipe,
ingredients, or serving is uncertain. If the photo cannot support a meaningful
numeric estimate, do not leave a model-reviewed capture blank. When its note is
empty, save a concise `--note` describing only the visible meal or food form and
material uncertainty; never replace a member-written note. Add `--ingredient`
values only for identities the photo supports. If even a broad food observation
is not defensible and the note is empty, record only that the retained image was
reviewed and the meal could not be identified. Read the preserved or new
observation back. Clarification is a last resort, not a confidence check: ask
one narrow identity or portion question only when actual attachment inspection
leaves identity or amount too indeterminate for any meaningful bounded estimate
and the answer would materially help.

A recent device meal remains unresolved after its attachment becomes a privacy
tombstone when its saved identity, amount or ingredients, and nutrition cannot
support the member's current request. When the member answers a capture question
or asks for totals or a card that meal blocks, match the existing meal from the
current conversation, device source, capture date, and capture time with bounded
`meal list` and `meal show` reads; never add a replacement or restore the photo.
Apply the estimation-eligibility rule above before recovery. When estimation is
skipped, do not ask for identity or amount merely to enable nutrition estimates.
Otherwise, ask instead of refusing or inventing totals only when the saved facts
still fail that last-resort threshold. With enough facts, edit and read back the
existing meal, then use fresh food-journal totals and any eligible card. Never
calculate around it or reuse pre-edit totals.

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
   by local capture date. A capture is eligible for member-visible presentation
   only when its local capture date equals the engine-supplied `Occurrence local
   date`. A late import from an earlier date remains full cleanup work, but it
   never authorizes a dated catch-up, card, question, or closeout text. When
   current and historical captures are selected together, exclude every
   historical capture from current-date presentation inputs.
3. Compare nearby meals before counting so a manual record or second photo of
   the same eating occasion is not silently double counted.
4. Run `vault-cli meal show <meal-id> --format json` for each selected meal and
   inspect the actual attachment for a photo-backed selection. For
   same-occurrence retry evidence, use only the already-saved structured fields
   and uncertainty. Enrich the existing meal when supported, apply the bounded
   re-identification and single-retry rule above after a failed edit, and read
   the result back. When numeric nutrition is unsupported, save and read back
   the evidence-based observation fallback above. A meal with neither saved
   nutrition nor that observation is not ready for cleanup.
5. Only after the read-back proves saved nutrition or the observation fallback,
   run `vault-cli meal remove-photo <meal-id>` and read the meal back again.
   This automatic-capture-only command preserves the structured meal and
   replaces retained image bytes with a privacy tombstone. Any removal failure
   fails the run. On retry, combine photos that remain with same-occurrence
   removal revisions so a provider or partial-cleanup failure loses no meal.

After all selected cleanup, stop before any presentation work when no selected
capture has the occurrence local date. Return
`{"kind":"skip","privateSummary":"Historical meal cleanup completed."}` and
run no Goal, totals, card, or clarification work. When current and historical
captures were selected together, continue with current-date captures only.

Before step 6, apply the estimation-eligibility rule above to those current-date
captures. When estimation is skipped, complete photo cleanup and stop with the
established non-numeric closeout: ask no estimate-enabling question and run no
Goal, totals, or card work. Otherwise, after cleaning each current-date capture
that still fails the last-resort threshold, send one compact question for only
those meals and stop before Goal, totals, or card work. Use local time for the
occurrence date. Ask only for missing identity and amount, expose no meal ids,
and do not substitute ordinary closeout or a dashboard refusal. This is the sole
scheduled-question exception; its answer uses the existing-meal recovery above.

6. After inspection, enrichment, read-back, and photo cleanup, run
   `vault-cli meal totals --from <occurrence-local-date> --to <occurrence-local-date> --resolve-goals --format json`.
   This query owns the complete active target scan and deterministic rules below;
   do not repeat goal list/show to re-resolve active authority.
   Use fresh canonical totals and `goalContext` points. `conflict`, `incompatible`,
   or `capacity` means ordinary compact closeout, no Goal or measurement
   mutation, no question, and no card. `ready` still requires the suitability,
   intent, and meal-completeness gates. Only `missing` permits the existing
   first-run proposal exception below. Historical compatibility is read-only
   display authority. This active-target authority read is separate from any
   all-status Goal lookup used to reuse or honor Murph's managed paused or
   abandoned proposal; never substitute that lookup here. If active authority
   is ambiguous, unit-incompatible, comparator-incompatible, or otherwise
   cannot support either a card or responsible proposal, keep the ordinary
   compact closeout without the unrelated safety fanout. Only when compatible
   authority is incomplete after those reads does the first eligible managed
   closeout have one proposal-only exception. Read and follow
   `$MURPH_ASSISTANT_SKILLS_ROOT/nutrition-strategy/references/daily-nutrition-card-goals.md`,
   then run `vault-cli goal list --limit 200 --format json` and detail-read only
   candidate managed records. If that read fails, is unreadable, is saturated,
   or finds any Goal with slug `murph-daily-nutrition-starting-targets` in any
   status, do not create, change, or automatically repeat a numeric proposal.
   Keep the ordinary compact closeout and attach no card. The absence of that
   managed Goal is the first-run authority; add no flag or second state owner.
   If responsible inputs are missing or the bundle is infeasible, write nothing
   and keep the ordinary closeout. When either one complete accepted card bundle
   or this responsible first-run proposal candidate remains, apply the concise
   known-context numeric-suitability rule in the
   `murph.attach_response_card` prompt before deriving or presenting numeric
   values, any Goal write, or a card. Do not run a universal medical
   history or measurement checklist. When known context suppresses numeric
   output or suitability remains unresolved, keep the ordinary compact closeout,
   perform no Goal or measurement mutation, ask no question, and attach no card.
   When the complete all-status
   lookup proves absence, known context permits numeric guidance, compatible
   explicit targets are unambiguous,
   and already-known inputs prove one responsible five-target bundle, create
   that single canonical Goal as
   `paused`, with `window.startAt` equal to the occurrence local date.
   Read it back, then explain all five provisional values, their material facts
   and assumptions, and the effective date in ordinary text. Ask no question,
   attach no card, and never activate it on the scheduled turn. Member
   correction, acceptance, or decline remains an
   interactive turn. If numeric presentation is suppressed, or the active
   target bundle is ambiguous, unit-incompatible, or comparator-incompatible,
   retain the ordinary compact closeout and do not attach a card. Keep the occurrence
   local date from step 1 as both the work boundary and the only scheduled card
   `localDate`. Historical captures are cleanup-only and never card inputs. A target
   qualifies only when that card date is on or after the containing Goal's
   `window.startAt`, on or before its optional `window.targetAt`, and inside the
   target's optional inclusive `startAt`/`targetAt` interval. Ignore an
   out-of-window target for current authority and conflict resolution; never
   copy, expose, derive from, or mutate a Goal because of it. If fewer than five
   applicable targets remain, ask no question and use ordinary closeout text.
   New authoring uses `dietary-calories`. Resolve that canonical owner first;
   when it exists, use it and ignore every globally ambiguous `calories`
   target. Only without a canonical owner may an applicable exact-point
   `calories` target in `kcal` fill the card's calorie slot when its
   `targetId` is `daily-calories`. Its same containing Goal must own exactly one
   applicable compatible point for every historical id, metric, and unit pair:
   `daily-protein` / `protein-grams` / `g`, `daily-carbohydrates` /
   `carbs-grams` / `g`, `daily-fat` / `fat-grams` / `g`, and `daily-fiber` /
   `fiber-grams` / `g`. Require one complete historical set. Any other
   `calories` target is not dietary authority even when the four nutrition
   metrics share its Goal; never combine the historical set with another Goal
   or managed proposal. Never infer ownership from a title, slug, domain, or
   description, and never rename or mutate a Goal just to repair this key.
   A target in another unit remains authoritative, but never compare, convert,
   or copy its raw value into this fixed-unit card; on a scheduled occurrence,
   ask no question and use ordinary closeout text. Never infer a target from
   this day's meal total or one wearable day. A card-qualifying target must also
   be an exact point with comparator `between` and identical numeric `value` and
   `highValue`. Accept `selected-value` evaluation normally. The complete
   same-Goal historical `daily-*` set above may instead use the read-only
   rolling-mean plus daily-aggregate-mean display compatibility in the shared
   daily-card reference; preserve the Goal and do not extend that exception. A
   mixed evaluation bundle or another rolling-window or daily-aggregate
   statistic is incompatible. A one-sided `<`, `<=`, `>`, or `>=` threshold,
   non-identical range, or other shape remains authoritative but is incompatible
   with this point-target card.
   Never expose, compare, copy, or derive from its bound, and never create,
   replace, or remove a managed target around it. On a scheduled occurrence,
   ask no question, perform no Goal or measurement mutation, and use ordinary
   closeout text without a card.
7. Only when the complete target-authority read in step 6 resolves one
   unambiguous card-authorizing bundle, use its fresh canonical totals
   immediately before any response-card attachment. If a meal or Goal changed
   after that read, rerun `vault-cli meal totals --from <occurrence-local-date>
   --to <occurrence-local-date> --resolve-goals --format json` first; otherwise
   do not repeat the read. Never calculate nutrition independently or reuse
   totals from an earlier turn. On an interactive card
   request, apply food-journal's selected-date incomplete-meal recovery to
   every saved meal whose nutrition coverage blocks the card, including a
   manual, conversation, provider, or device meal not selected by this
   closeout. Do not widen the scheduled-question exception above: a scheduled
   run follows its existing compact closeout when an unselected meal remains
   incomplete. When the canonical read includes a calorie total and
   the card-time safety gate from step 6 still passes, call
   `murph.attach_response_card` with this exact mapping:
   `card: { kind: "daily_nutrition", version: 2, localDate:
   <occurrence-local-date>, mealCount: <top-level mealCount>, totals: { calories,
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
   missing calories, an incomplete or conflicting active target bundle, or
   numerical suppression, retain the current compact text, one-question, or
   non-numeric behavior and do not attach a card. Never attach the photos.
   Historical-only work already returned the required skip before this step;
   historical captures never become presentation inputs for current-date work.

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
