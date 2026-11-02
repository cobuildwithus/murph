# iOS Meals API

Last verified: 2026-11-02

## Scope and ownership

The v2 game app opens Meals from You. This contract adds list, detail and
accepted removal for meals Murph logged. It changes the iOS-facing contract
proposed in #4420: `photo` is a nullable private thumbnail delivery, and
`uploadId` is an exact nullable phone upload identifier. Reads include `savedAt` and the vault's canonical `timeZone`.

Canonical meal events and lifecycle tombstones remain in the encrypted member
vault. Structured meals are derived into generation 17 of the existing encrypted
Browser Vault core shard. Companion reads unwrap that saved shard through the
same member-bound authority as Journal. They never start, wake, refresh or wait
for the runtime. No new health table or durable plaintext copy is created.

All Meals requests use `Authorization: Bearer <native-session-token>`, no cookies,
and no member selector. Responses, including errors, use `Cache-Control: no-store`.
Active hosted access and current launch consent are required. Game-only members
receive the existing 403; the app may show its own photos without server names.
Session, access and consent are checked again after decryption; removal repeats
those checks under the mailbox admission locks.

## List

`GET /api/device-sync/companion/meals?limit=7&cursor=2026-11-02`

No body. `limit` is optional, defaults to 7 and accepts 1–31 **days**. `cursor`
is optional and is the exclusive local day boundary returned as `nextCursor`.
Only these query parameters are accepted, each at most once. Dates must be real
`YYYY-MM-DD` dates. There is no client timezone parameter or game timezone fallback.

Exact synthetic 200 response (one populated day):

```json
{
  "timeZone": "America/New_York",
  "savedAt": "2026-11-01T18:00:00.000Z",
  "days": [
    {
      "date": "2026-11-01",
      "calories": 520,
      "proteinGrams": 32,
      "carbsGrams": 58,
      "fatGrams": null,
      "mealCount": 1,
      "calorieMealCount": 1,
      "meals": [
        {
          "id": "meal_01JNV42NP0KH6JQXMZM1G0V6SE",
          "eatenAt": "2026-11-01T17:30:00.000Z",
          "name": "Chicken grain bowl",
          "calories": 520,
          "proteinGrams": 32,
          "carbsGrams": 58,
          "fatGrams": null,
          "uploadId": null,
          "photo": null
        }
      ]
    }
  ],
  "nextCursor": null
}
```

Days and meals within each day are newest first, with ID as the deterministic
same-instant tie-breaker. Days without meals are omitted. A day is never split:
its totals and counts cover all canonical selected meals on that local day.
Nutrients sum only known estimates; if no meal supplies a nutrient its total is
null, including calories. A real zero stays zero. `calorieMealCount` distinguishes
partial from complete calorie coverage. Values are approximate, not targets.
`name` prefers the canonical event title written by `meal add/import-json/edit
--name`: a sentence-case dish name, normally 2–5 words and at most 40 characters.
Description, portions, places, and uncertainty stay in `note`. The CLI requires a name for add/import and rejects invalid title edits before
mutation. A shared policy checks 2–5 words, 40 characters, lowercase starts, food
lists, leading meal-type/uncertainty/photo phrases, and explicit venue syntax or
multiword title-cased venue prefixes. Named culinary exceptions remain valid.
Raw automatic photo intake may retain its unreviewed placeholder until clarification. This uses the existing title
field, not a new canonical schema.

For older meals, projection construction skips the generic `Meal` title, then
uses legacy mealName/dishName/note fields. It strips leading meal-type prefixes,
Estimated, Photo shows, and Retained image reviewed phrases, cuts at the first
semicolon or spaced hyphen, and preserves the existing 120-character legacy
cap. It returns null when no useful label remains. This deterministic fallback
never changes the vault or nutrition and never invokes a model. Existing saved
projections gain the cleanup at their next ordinary runtime refresh.
`eatenAt` is an ISO instant and `id` is an opaque stable meal/event lookup ID.

`nextCursor` is the last returned day when older days remain, otherwise null.
A valid empty projection returns `days: []`, `nextCursor: null`, with its actual
`timeZone` and `savedAt`. An unavailable projection never becomes an empty list.
Each page uses the latest saved snapshot, not an anchored multi-request snapshot;
refresh the first page when `savedAt` changes if the app needs consistent paging.

## Detail

`GET /api/device-sync/companion/meals/{mealId}` has no body.
Exact synthetic 200 response:

```json
{
  "timeZone": "America/New_York",
  "savedAt": "2026-11-01T18:00:00.000Z",
  "meal": {
    "id": "meal_01JNV42NP0KH6JQXMZM1G0V6SE",
    "eatenAt": "2026-11-01T17:30:00.000Z",
    "name": "Chicken grain bowl",
    "calories": 520,
    "proteinGrams": 32,
    "carbsGrams": 58,
    "fatGrams": null,
    "uploadId": null,
          "photo": null
  }
}
```

This reads the same saved projection as the list. Unknown, removed and another
member's IDs all return `MEAL_NOT_FOUND` without disclosing ownership.

## Removal

`DELETE /api/device-sync/companion/meals/{mealId}` accepts **no request body**.
The ID must exist in this member's available saved projection. Exact synthetic
202 response:

```json
{"accepted":true,"actionId":"2f1c1fdc-c7b0-4d90-b902-8e6295959243"}
```

This means the typed `meal.delete` action was durably queued in the existing
encrypted member mailbox, never that deletion completed. A failed or timed-out
post-commit wake does not undo acceptance; the existing handoff sweeper retries.
The runtime applies `deleteMealRecord` → `deleteEvent`, appending the canonical
lifecycle tombstone. The meal then disappears from subsequent projections and
stops contributing to Murph's nutrition reads. Upload metadata is not the owner.
Deletion also retires the canonical thumbnail and any remaining full photo.
Encrypted media objects are removed by the existing runtime snapshot cleanup;
metadata-only privacy tombstones preserve append-only history references.
Account deletion uses the existing encrypted-object cleanup for both copies.

Hide the meal optimistically after acceptance. Until a new projection is saved,
or if the runtime rejects removal, it may reappear on a read. Missing canonical
records and revision conflicts yield existing post-checkpoint rejected outcomes
(`meal_not_found`, `meal_changed`); unexpected failures follow mailbox retry.
The iOS page does not need a new action-status endpoint. Repeated HTTP requests
can enqueue separate actions; canonical deletion cannot double-count a tombstone.

## Errors

All new domain errors use exactly this envelope shape:

```json
{"error":{"code":"MEALS_PROJECTION_UNAVAILABLE","message":"Saved meals are temporarily unavailable.","retryable":true}}
```

| HTTP | Code | Meaning / message |
| --- | --- | --- |
| 400 | `MEALS_INVALID_CURSOR` | `The meals cursor is invalid.` |
| 400 | `MEALS_INVALID_REQUEST` | `Use one cursor and limit.`, `Limit must be between 1 and 31 days.`, or `Meal removal does not accept a body.` |
| 404 | `MEAL_NOT_FOUND` | `That meal is not available.` Malformed, missing, removed or foreign ID. |
| 503 | `MEALS_PROJECTION_UNAVAILABLE` | `Saved meals are temporarily unavailable.` Missing/old replica, missing canonical timezone/Meals section, unavailable session/control, malformed or undecryptable snapshot. |
| 503 | `MEAL_REMOVAL_UNAVAILABLE` | `Meal removal is temporarily unavailable.` Mailbox admission could not be confirmed. |

The 400 and 404 errors have `retryable: false`; the new 503 errors have
`retryable: true`. Authentication and authorization run before data is returned.
Shared errors remain unchanged:

| HTTP | Code | Meaning |
| --- | --- | --- |
| 401 | `AUTH_REQUIRED` | Missing, malformed, expired or revoked native session; cookies also rejected. |
| 403 | `HOSTED_ACCESS_REQUIRED` | No active hosted access, including game-only members. |
| 403 | `HOSTED_MEMBER_SUSPENDED` | Suspended hosted account. |
| 403 | `HOSTED_CONSENT_REQUIRED` | Current launch consent missing; may include `details.missingScopes`. |
| 426 | `AUTH_CLIENT_UPGRADE_REQUIRED` | Retired credential format; update the client. |
| 503 | `AUTH_UNAVAILABLE` | Authentication service configuration unavailable. |
| 500 | `INTERNAL_ERROR` | Unexpected shared infrastructure error; generic message, `retryable` can be omitted. |

Shared domain errors normally include `retryable: false` and may include
`details`. Branch on code/status, not message text. A projection error takes
precedence over meal lookup; do not interpret it as a missing meal.

## Local photo association

`uploadId` is the phone's existing `Idempotency-Key` for a meal-photo upload:

- Manual `POST /api/device-sync/companion/meal-photos`: the lowercase UUID already
  sent by `CompanionAPI` from `ManualMealPhotoSelection.idempotencyKey`.
- Automatic `POST /api/device-sync/companion/meal-photo-capture/photos`: the
  existing 64-character capture ID already sent by the capture uploader.

Both list and detail return the same nullable opaque string (1–128 characters).
For example, an uploaded meal has `"uploadId":"2f1c1fdc-c7b0-4d90-b902-8e6295959243"`;
a typed meal has `"uploadId":null`. No upload-request field or header change is
needed. Existing member-bound server capture IDs, deduplication and accepted
upload responses are unchanged.

The identifier travels in the existing encrypted photo wake, then one optional
canonical meal field on the exact record created by photo import. Murph enriches
that existing record. Browser Vault projects the field directly. The upload link adds no image bytes, store, or timestamp association. IDs are not
logged. Normal snapshot publication determines when the link becomes readable.

For the existing iOS local history, look up the returned ID directly for automatic
captures. Manual thumbnails are stored under lowercase hex SHA256 of UTF-8
`"manual:" + lowercase UUID`; use the existing
`MealPhotoCaptureCrypto.manualCaptureID(idempotencyKey:)` conversion for a UUID
before looking up that thumbnail. The selection's separate UI UUID is not this
upload identifier. iOS must decode `uploadId` as an optional string and join it
to its local history while keeping the server meal ID for detail and removal.

Historical automatic captures can recover `uploadId` at read time. The saved
encrypted core entity must identify the same meal, device source and exact
`meal-photo-capture` / `photo` external reference, and the member-bound mailbox
metadata must contain an automatic-upload dedupe key with that capture ID.
The API reads only those receipt identifiers in one set query; no image bytes,
mailbox ciphertext, timestamps or nearest-photo inference are used. Explicit
canonical upload IDs take precedence.

Existing snapshots gain this provenance at their next ordinary runtime
publication. Reads never wake the runtime or rewrite vaults. Missing receipts,
older snapshots, typed/texted meals and legacy manual-only captures stay null.
The historical manual capture hash cannot recover the phone UUID. A retry does
not rewrite the canonical meal. Show a plain tile for null or missing local thumbnails.
No `source`, `thumbnailUrl`, `photoUrl`, or full-size URL exists in this contract.

## Private thumbnail

List and detail always include `photo: { url: string; width: number; height: number } | null`.
For example (synthetic capability, not a working URL):

```json
{"photo":{"url":"https://murph-hosted.cobuildwithus.workers.dev/private-media/v1/opaque-capability/meal-thumbnail.jpg?exp=1793635500","width":640,"height":427}}
```

The JPEG is at most 640 pixels on its long edge, oriented and stripped of EXIF
and location metadata. It is encrypted at rest using the member's existing
vault-media keys. The owner-authorized meal response mints an opaque bearer URL
valid for five minutes using the existing private-media capability pattern.
Treat the URL as private: possession permits delivery until expiry; do not log
or share it. Both API and image responses disable caching. Refresh the meal to
obtain a new URL. Width and height describe the oriented thumbnail.

`photo` is independent of `uploadId`: texted photos can have a thumbnail and a
null upload ID. Missing source images, older saved projections and unfinished
backfill return null. An expired or deleted image URL returns 404. The API never
wakes a runtime to generate a thumbnail and never exposes full-photo URLs.

Canonical maintenance creates thumbnails from remaining full photos in batches
of at most ten, resumes through ordinary runtime retention wakes, and retries
unavailable input. Thumbnails remain while the meal exists. Full-photo bytes
are retired after `INBOX_IMAGE_RETENTION_DAYS` (90) from immutable capture time.
For historical images without capture metadata, the original import time is
used; editable `eatenAt` never resets retention. Already-purged full photos cannot
be recovered. The existing retention jobs and encrypted-object cleanup apply;
this is not a synchronous deletion guarantee for inactive vaults or backups.
Murph can inspect the retained `photo_thumbnail` attachment after full-photo
expiry. Automatic closeout marks a full photo `reviewed_photo` and stamps
`photoReviewedAt`; it no longer destroys the photo immediately or requeues a
reviewed meal just because a thumbnail was generated.

Web readers deploy before runtime writers. New canonical fields are optional;
old saved records remain readable. Once thumbnail maintenance writes them,
retain this release as the Web/runtime rollback floor. The hosted rollout must
evacuate old member runtimes before resuming their canonical workspace on the
new image. Older Workers return no thumbnail deliveries during Web-first skew.

## Release order and compatibility

The upload-link reader release (#4435, merge
`21f806eb67f01b1c346846b9eea2ab31f4f6e4e3`) must converge in Web and all runtimes
before shipping the writer. Pre-reader runtimes reject the new optional canonical and
nested wake fields; pre-reader Web rejects non-null projection upload IDs.
After writes begin, retain this reader release as the Web/runtime rollback floor.
The reader release emits no new upload metadata, so it can safely coexist with
the old runtime. The writer accepts both old and linked records. Web can deploy
the writer before the writer runtime: the converged reader accepts its wake and
imports it without the link. Such rollout-window meals remain canonically unlinked; historical read-time
recovery above can still supply their ID. There is no vault backfill or forced wake. After the writer runtime deploy, new imports retain the
link. Both runtime versions can read linked canonical records during rollout.


Web ships first and accepts only generation-17-or-newer replicas that contain
the structured Meals section. Older or missing projections fail with
`MEALS_PROJECTION_UNAVAILABLE`, including DELETE, without sending the new action
to the old runtime. Reads do not trigger upgrades. The runtime that publishes
that member's new projection contains the typed consumer. Ordinary later runtime
work publishes it; inactive members can remain unavailable until then.

Deploy the runtime from main after Web. Once new actions are admitted, retain
the meal.delete consumer as a runtime rollback floor. Do not roll back to a
runtime that cannot parse admitted actions. New readers accept legacy replicas
for existing Browser Vault uses; only Meals requires its new section. Follow
the hosted deployment workflow's image-pair admission and convergence checks.

## Existing endpoints the app can use

All requests below use the existing first-party native
`Authorization: Bearer <native-session-token>`. The server derives the member;
do not send a member ID to select another account. Responses use
`Cache-Control: no-store`. JSON examples are synthetic, and read examples are
field selections from larger responses unless explicitly stated otherwise.

### Edit with Murph

`GET /api/device-sync/companion/initial-onboarding` has no request body and
returns `contactAction` for both pending and completed onboarding:

```json
{
  "status": "completed",
  "messagingSetupRequired": false,
  "telegramAwaitingInbound": false,
  "contactAction": {
    "kind": "text",
    "label": "Messages",
    "href": "sms:+12025550100?body=Hey%20Murph%2C%20do%20your%20thing"
  }
}
```

Use the recipient in this member-resolved `sms:` link. Replace its existing
onboarding body with a percent-encoded, locally composed meal-edit draft.
Opening Messages does not send the message or confirm a meal edit. Never use a
hard-coded Murph number. The auth/session endpoint only exposes session identity
and expiry; it is not the contact source.

`contactAction` can be null, or have `kind: "telegram"` or `"email"`. Only
`"text"` supports this Messages action. Preserve setup/unavailable handling;
do not invent an SMS destination for another channel. Contact projection failure
deliberately returns null without failing onboarding. The endpoint requires
active member access, which is distinct from game-only access.

### First name

Read `GET /api/game/v1/home` (no body), using `me.firstName`:

```json
{
  "ok": true,
  "me": {
    "memberId": "member_example",
    "firstName": "Player",
    "timeZone": "America/New_York",
    "avatarUrl": null,
    "usualKind": null
  }
}
```

`firstName` and `timeZone` can be null before profile creation. Edit with
`PUT /api/game/v1/me/profile`, `Content-Type: application/json`:

```json
{"firstName":"Player"}
```

The complete successful write response is:

```json
{
  "ok": true,
  "game": null,
  "profile": {
    "memberId": "member_example",
    "firstName": "Player",
    "timeZone": "America/New_York",
    "avatarUrl": null
  }
}
```

Sparse edits preserve other fields. Initial creation requires both `firstName`
and an IANA `timeZone`; a name-only edit without a profile returns
`409 PROFILE_REQUIRED`. Names are cleaned and trimmed, then limited to 1–200
characters; invalid values return `400 INVALID_REQUEST`. These endpoints use
game access, not the companion active-access gate. Profile edits do not require
renewed legal consent. This is the game profile's first name, not a new vault
profile owner.

### Apple Health freshness

`GET /api/device-sync/companion/status?sourceProviderSlug=apple_health_kit`
has no body. Its complete response shape is:

```json
{
  "lastDataReceivedAt": "2026-11-01T15:00:00.000Z",
  "observedAt": "2026-11-01T15:04:00.000Z",
  "resources": {
    "sleep": {"lastReceivedAt":"2026-11-01T15:00:00.000Z"}
  }
}
```

Use the difference between the two timestamps for receipt age, advancing it
with elapsed client time between refreshes. A null `lastDataReceivedAt` means
no qualifying receipt; show a waiting/unavailable state, not "Synced". The
source filter prevents another provider's success from counting as Apple Health.
Resources are dynamic and can be empty or contain null timestamps.

"Synced 4 min ago" describes backend receipt evidence, not proof that every
HealthKit sample has reached the vault. Lifecycle callbacks and data-less
historical completion do not count. This endpoint requires active member access
and historical launch consent. It supplies no health values.

### Existing errors

Domain errors use the shared envelope, for example
`{"error":{"code":"AUTH_REQUIRED","message":"Sign in to continue.","retryable":false}}`,
with optional `error.details`. Generic body/internal errors can omit `retryable`.
Error messages are display text, not enums.

| Endpoint | Relevant errors |
| --- | --- |
| Companion onboarding/status | `401 AUTH_REQUIRED`; `403 HOSTED_ACCESS_REQUIRED` |
| Companion status | `403 HOSTED_CONSENT_REQUIRED`; malformed source slug: `400 COMPANION_REQUEST_INVALID` |
| Game home/profile | `401 UNAUTHENTICATED`; unavailable game access: `404 GAME_DISABLED` |
| Game profile | `400 INVALID_REQUEST`; missing initial profile: `409 PROFILE_REQUIRED` |

Unexpected server failures remain errors, never an empty successful meal list.


## One-time legacy naming repair

The Ops-only `/api/ops/meal-name-repair` action uses the existing encrypted member
mailbox, hosted Sol route, canonical event revision writer and checkpoint/projection
publication. It is deliberately separate from reads and sends no member messages.
Each invocation scans at most 100 eligible records and makes at most five tool-free
name proposals. Each proposal receives only that meal's name and note; invalid or
oversized evidence is skipped. Original name wording absent from the note is
appended mechanically. Nutrition, source, times, IDs and attachments are preserved.

Portable versioned progress under `.runtime/operations/meal-name-repair/v1.json`
records the fixed scan boundary, cursor, pending revision-checked write and numeric
batch receipts. Replaying a batch returns its original cumulative counts. A pending
write is reconciled against the exact resulting revision before counting it; a
concurrent edit is skipped. Foreground input preempts model work and the mailbox
retains the accepted request with its existing retry deadline. Usage accounting
explicitly disables member notice delivery. The operator client checks projection
freshness against the recorded completion time so reruns need no new snapshot.
Canonical reads
reuse the existing vault event reader; provider/write work is bounded per batch.

Deploy Web's compatible action/result readers first, converge the runtime consumer,
then execute for the signed-in Ops owner and verify the companion Meals API before
running paginated active member workspaces. `skipped` includes already-valid names;
`invalid` and `changed` are its unresolved subsets. Inactive members and workspaces
without a snapshot are outside existing runtime admission. Remove the temporary
Ops action/job after the eligible population has terminal counts and verified
projection publication; retain the shared naming policy.
