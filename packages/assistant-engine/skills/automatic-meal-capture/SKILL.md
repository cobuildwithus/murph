---
name: automatic-meal-capture
description: Use for Murph iPhone automatic meal capture setup, Photos permissions, background behavior, the on-device Meals review page, missing or delayed imports, and calorie-aware enrichment of automatically captured meal photos.
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
or interpreting meal patterns. When calorie or macro tracking is explicitly
active, load this skill alongside `food-journal` on every eligible interactive
nutrition turn and check recent unresolved device meals. Use
`nutrition-strategy` for forward-looking decisions about what to eat.

## Set up the iPhone app

Use the shortest relevant setup path:

1. Automatic meal capture requires an iPhone on iOS 26.1 or later.
2. Download or open Murph from
   `https://apps.apple.com/us/app/murph-ai/id6786145859` and sign in to the same
   Murph account used in the conversation. Follow the developer prompt's URL
   placement rule when sending the link.
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
record instead of using conversation silence as evidence of failure. When
calorie or macro tracking is explicitly active, inspect and enrich unresolved
device meals on the next eligible interactive turn; do not claim this happened
at import time.

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

## Enrich calorie or macro tracking

Treat calorie or macro tracking as active only when the member's request,
current plan, or durable context makes that focus explicit. Do not infer it from
a generic health or weight goal.

When this skill is loaded for a calorie-tracking turn:

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
   weakest material assumption. Preserve the meal's occurred-at time, source,
   and photo attachment.
6. Read the edited meal back before claiming it was logged.

Do not run `meal add` for a captured photo that already has a meal id. The
automatic import is the meal log; `meal edit` adds the useful structure. A
standing calorie-tracking focus is enough to save a bounded photo estimate
without asking for confirmation on every meal, but the estimate must retain
provenance and uncertainty. If the photo cannot support a meaningful estimate,
leave the photo-only meal intact and ask one narrow portion or identity question
only when the member is present and the answer would materially help.

Do not surface unsolicited calorie numbers for simple meal logging,
intuitive-eating contexts, eating-disorder risk, or number-sensitive members.

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
