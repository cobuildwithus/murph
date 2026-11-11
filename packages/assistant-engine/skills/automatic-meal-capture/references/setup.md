# Automatic meal capture: setup and questions

Read this when a member asks how to track meals, how automatic capture works,
how to set it up, what Murph can see, or why a photo did not arrive.

## Which way of tracking to lead with

In a private conversation, when the member asks how to start tracking meals:

- If their phone is unknown or a compatible iPhone, they have not said they
  prefer logging by hand, and capture is not already on, lead with automatic
  capture. Say they can download or open the Murph iPhone app, turn on Meal
  capture, and have new food photos picked up without messaging each meal.
  Give the App Store link and the setup steps in that first answer, and mention
  that texting a meal, a voice note or a photo still works. If you do not know
  their phone, state that it needs a compatible iPhone and carry on without
  asking.
- If they use Android or another phone that cannot run the app, or they prefer
  logging by hand, lead with text, voice-note and photo logging as
  `food-journal` describes. Bring up the app only if they ask.
- If capture is already on, answer the question they asked about capture,
  review or recovery. Do not send them through download or setup again.

The app is one option. Meal tracking never requires it.

In a group, answer a general meal-tracking question with text, voice-note and
photo logging. Share the App Store link only when someone asks how to get the
app, and keep sign-in, permissions and personal setup in that person's private
conversation or the app.

## Setup steps

Give the shortest set of steps that fits the question.

1. Automatic meal capture needs an iPhone on iOS 26.1 or later. There is no
   Android version.
2. Download or open Murph from
   `https://apps.apple.com/us/app/murph-ai/id6786145859` and sign in to the
   same Murph account used in this conversation. Follow the developer
   prompt's URL placement rule when sending the link.
3. In Murph, open the menu, open Settings, choose Meal capture, and choose Set
   up. If Meal capture is missing after updating the app, that build does not
   support it, so do not send the member around the setup again.
4. Continue through Murph's explanation and grant **Full Photos** access in
   Apple's prompt. Limited Photos access is not enough. There is no second
   background permission to grant.
5. Check that the Settings row says On. Only photos added after that point are
   picked up. Earlier photos are never scanned and cannot be chosen.

Once a photo has been imported, Murph also runs a closeout at 9:00pm in the
vault timezone each day. It needs no separate opt-in. It is delivered to the
member's existing private iMessage or Telegram conversation, or to a verified
email address.

## What the app does

- It looks only at images added after capture was turned on.
- The phone makes a size-limited JPEG with metadata removed and runs Apple's
  Vision classifier on the device.
- Likely meals upload automatically. Uncertain ones stay on the phone in the
  recent Meals list until the member chooses Approve & send. That list holds 24
  items, and an item can drop off after 14 days or when newer ones fill the
  list. Murph cannot see or log an uncertain photo before it is approved.
- Clear non-meals stay on the phone and only add to an on-device count.
  Screenshots and non-image files are rejected before upload.
- Murph never receives the original filename, location, camera metadata,
  Vision labels or classifier confidence.
- An uploaded photo arrives a little later as one meal with the photo, the
  time it was taken, and no foods or numbers yet.

Background capture is best effort. iOS decides when the app may run and can
delay or skip a turn, and opening Murph runs the same catch-up at once. After a
long idle period the app may need to be opened to renew its upload permission.
Do not promise instant logging, that every meal will be caught, or that the
member never needs to open the app.

## Check that a photo arrived

1. Run
   `vault-cli meal list --from <YYYY-MM-DD> --to <YYYY-MM-DD> --limit 20 --format json`
   for the local date the photo was taken. Add the neighboring date when the
   photo was taken near midnight or in another timezone.
2. Find the recent meals that have a photo. Run
   `vault-cli meal show <meal-id> --format json` when the list is not detailed
   enough or you need to look at the photo.
3. Confirm arrival only from a returned meal with its photo and capture time,
   and tell the member plainly what you found. A quiet conversation is not
   evidence that the upload failed.

"Sent" in the app means the upload was accepted. The meal can take a moment
longer to appear. If a photo sent just now is missing on the first read, say it
may still be landing and read once more. If it is still missing, say the import
is pending. Suggest sending it again only when later evidence shows the upload
failed. A photo still waiting in the phone's Review list has not been sent, so
Murph cannot see it yet.

## Other situations

- **Limited or revoked Photos access.** Capture pauses or stays off. Point the
  member to iOS Settings to grant Full Photos access.
- **Photos stored in iCloud.** iOS may need to download the photo first, which
  can delay it or make it fail. Murph does not connect to iCloud.
- **A deleted or unavailable photo.** An item in the phone's list can lose its
  thumbnail or become unsendable. Do not say the server has a copy.
- **Low light, mixed plates, packaging, or objects that look like food.** The
  classifier and portion estimates can be wrong. Go by the photo itself and
  keep the uncertainty.
- **Several photos of one meal.** Each can become its own meal. Count the meal
  once, as "Check for a duplicate" in `automatic-meal-capture/SKILL.md`
  describes.
- **Setup keeps failing.** Check the iOS version, that the app is current from
  the App Store, that it is the same Murph account, the network, and Full
  Photos access. After one more failed attempt, say which step is unresolved
  and do not say capture is on.
