# iOS Meals page: integration boundary

Last verified: 2026-11-01

## Status

The v2 game app opens Meals from You. The intended page shows meals Murph
actually logged, rather than the old companion's local pending/sent photos.
**Hold: meal list, detail, and removal need an architecture decision.** This
document records the existing contracts and the decision needed before adding
those routes. No runtime or iOS-facing wire contract changes in this work.

First name, Apple Health receipt freshness, and the private Murph contact link
already have endpoints. Do not add duplicate companion endpoints for them.

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

## Where meal truth lives

- `packages/core/src/mutations.ts` (`addMeal`) writes the canonical meal event
  and raw attachment manifest inside the member vault. Hosted runtime checkpoints
  encrypt that workspace. Web's upload enrollment, staging objects, and mailbox
  receipts are not a meal database.
- `packages/vault-usecases/src/usecases/document-meal-read.ts` owns meal
  list/show/edit/delete; `packages/query/src/meal-nutrition.ts` reads stored
  nutrition and coverage. The assistant food-journal skill and vault CLI use
  these owners. Recent recall uses the descending timeline; `meal list` itself
  is oldest first. Do not take its first page and reverse it for latest meals.
- `apps/web/src/lib/foods.ts` queries the shared food-label catalog, not member
  meals. The iMessage card route renders a validated presentation payload;
  neither it nor `nutrition-card-image.tsx` queries current meal truth.
- The companion Journal endpoint already decrypts a saved Browser Vault core
  shard with member authority checks before and after the external read. It
  does not wake the runtime. Meal entities currently have no structured meal
  attributes in `projectSafeEventAttributes`; Journal's display strings are not
  an API for nutrition. The replica does not carry raw meal photos.
- `deleteMealRecord` delegates to the revision-checked canonical `deleteEvent`.
  It appends a lifecycle tombstone and audit record. **Reuse soft deletion**;
  do not delete an upload receipt or hide a row only on the phone. Retained raw
  paths are separate from excluding a meal from active nutrition reads.
- Hosted photo import writes `source: "device"` and a `meal-photo-capture`
  external reference. Manual camera and picker submissions share one upload
  shape. Historical records cannot reliably distinguish camera, picker, text,
  automatic library capture, and other imports using the requested three-way
  enum. Absence of a photo does not prove text origin.
- Staged encrypted photos are deleted after the successful runtime checkpoint.
  Automatic-capture closeout also removes retained canonical photos while
  keeping the structured meal. Existing privacy cleanup must remain intact.

See [Architecture](../../ARCHITECTURE.md#meal-photo-capture),
[Journal](journal.md#read-model), and
[nutrition cards](nutrition-totals-card.md) for the current owners.

## Architecture decision

| Option | Cost | Privacy impact |
| --- | --- | --- |
| Extend the encrypted Browser Vault projection and reuse a typed encrypted mailbox action for deletion (recommended) | Moderate: structured meal projection/generation change, bounded pagination, refresh and deletion receipt semantics, and a private photo-delivery path. Reuses Journal authority and canonical runtime writes; reads can be stale. | Keeps canonical health truth in the vault and derived data in the existing encrypted replica. Photos need separately authorized, expiring delivery and the existing removal lifecycle. |
| Add a live runtime meal read/write RPC | High: restore/wake latency, availability, bounded runtime admission, authorization, cancellation, and write fencing for app requests. | Avoids another durable meal projection, but introduces a new route into the decrypted workspace. |
| Maintain an encrypted Web-owned meal read model and image store | Highest: new schema, publish/reconcile/backfill/delete protocol, and consistency proof with canonical writes. | Adds another durable copy of health data and new retention, key, revocation, and account-deletion obligations. |

The first option is a recommendation, not an approved implementation. A signed
game-image URL pattern exists in `apps/web/src/lib/game/media.ts`, but raw vault
meal attachments are not game images. Reusing signing does not authorize copying
them into that store or changing their retention.

Resolve the projection and mutation transport, stale-read/removal behavior,
photo availability/retention, and a truthful unknown/other provenance value before
implementing meal routes. Select the canonical member timezone explicitly; the
game profile timezone is not automatically the vault timezone. Game-only members
also need a deliberate access decision rather than bypassing health-data gates.

## Deferred meal API requirements

No meal list, detail, or DELETE route is shipped here. The following paths and
JSON are a **proposal only**, so the iOS app must not call them yet:

- `GET /api/device-sync/companion/meals`: bounded newest-first results grouped
  by local date, with a stable cursor and declared timezone. Complete-day totals
  must not be calculated from only the visible page of meals.
- `GET /api/device-sync/companion/meals/{id}`: same meal fields plus nullable
  `photoUrl` for a retained full-size photo.
- `DELETE /api/device-sync/companion/meals/{id}`: no body; invoke canonical
  tombstoning. A queued `202` must not mean removal has completed. The chosen
  transport must specify completion/retry and projection convergence first.

Illustrative list payload (all nutrition fields independently nullable):

```json
{
  "timeZone": "America/New_York",
  "freshness": "fresh",
  "nextCursor": null,
  "days": [{
    "date": "2026-11-01",
    "calories": 520,
    "calorieMealCount": 1,
    "mealCount": 1,
    "meals": [{
      "id": "meal_example",
      "eatenAt": "2026-11-01T17:00:00.000Z",
      "name": "Chicken grain bowl",
      "calories": 520,
      "proteinGrams": 35,
      "carbsGrams": 58,
      "fatGrams": 17,
      "thumbnailUrl": null,
      "source": "unknown"
    }]
  }]
}
```

The proposed `unknown` value requires agreement because legacy provenance cannot
satisfy only camera/picker/text. Missing meal names and uncertain eating times
likewise need truthful display fallbacks, not fabricated labels or timestamps.
An all-unknown calorie day has `calories: null`; a partially estimated day must
retain coverage, not imply a complete daily intake. No estimate means null, not
zero. Stable IDs, local-day/DST ordering, deleted meals, cursor/day boundaries,
expired image links, and cross-member access all need synthetic tests.

Future errors must distinguish unauthorized access, inaccessible/missing meals,
invalid cursors, stale revisions, and unavailable runtime/replica state. Exact
codes and delete success JSON are deferred with the transport decision. Never
return an empty list to conceal unavailable data. Never log meal text, image
URLs, or raw input; bind safe metadata locals before any logging. Photos must
use member-authorized signed URLs and return null after privacy removal.
