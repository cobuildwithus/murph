# Wake-driven wearable delivery with background Bluetooth

Status: completed
Created: 2026-10-05
Updated: 2026-10-05

## Goal

Make a requested WHOOP or Garmin buzz reachable while Murph is backgrounded or
the phone is locked, as a best-effort wake rather than a foreground-only poll.
Keep the assistant tool contract and the command ledger unchanged.

## Success criteria

- With Murph suspended or the phone locked (not force-quit, Background App
  Refresh on), a buzz normally reaches a linked band and records `acknowledged`.
- When the background wake cannot run, a permitted visible notification invites
  the member to open Murph; opening it delivers the buzz if still unexpired.
- The released poll app keeps its exact wire contract and behavior.
- Every outcome is reported truthfully; `queued` never implies a vibration.
- Physical-device proof across foreground, suspended, locked, terminated,
  restored, and notifications-disabled states before assistant wording changes.

## Scope

- In scope (Web): a generic companion push route, an Apple push sender, explicit
  wake-capable wearable actions beside the legacy poll actions, docs.
- In scope (iOS, `murph-ios`): installation id, push registration, background
  Bluetooth with state restoration, one delivery path used by the foreground
  timer and by wakes.
- Out of scope: on-band alarms, Android, delivery after force-quit, guaranteed
  eventual fallback (there is no durable executor), assistant tool changes.

## Constraints

- Apple background pushes need no permission and show nothing, require
  `apns-priority: 5`, are throttled, and are not delivered with Background App
  Refresh off, in Low Power Mode, or after force-quit. Alert pushes are priority
  10, need notification permission, and do not prove app code ran.
- Background Bluetooth keeps an established link but not the process; only
  Bluetooth events or pushes wake a suspended app, for roughly 30 seconds.
- External I/O stays outside database transactions; transactions stay short.
- No new dependency, scheduler, queue, or worker.

## Design

### 1. Two independent server primitives

- `companion_wearable_link` (wearable delivery owner): `(user_id, wearable)` ->
  `installation_id, link_id, updated_at`. The phone reports `link` when a band's
  Bluetooth link is ready and `unlink` when it drops. `link_id` is opaque, stable
  across restoration of the same band, and rotated when a different band is
  selected. Latest `link` wins; `unlink` deletes only an exact installation and
  link match. Enrollment is independent of push tokens.
- `companion_push_route` (transport address only, one row per member):
  `installation_id, token, environment, topic, alerts_allowed, updated_at`.
  `POST /api/companion/push-route` upserts under the existing bearer member,
  active-access, and consent checks; topics are an allowlist of the two bundle
  ids. `DELETE` needs only the authenticated member and deletes an exact
  installation match, so sign-out and consent-loss cleanup cannot be rejected.
- `apple-push` module (done): ES256 provider token via `node:crypto`, one HTTP/2
  request via `node:http2`, `apns-expiration` no later than command expiry,
  results `sent | unregistered | failed`. Unconfigured means `failed`, which is
  the kill switch. Payloads carry no reminder text.
- Both tables cascade with the member and are listed in account data coverage.

### 2. Explicit capability: legacy and wake actions side by side

Legacy `connect/poll/receipt/disconnect` with `sessionId` are unchanged. Wake
clients send `installationId` and `linkId` with `link`, `unlink`, `claim`, and
`receipt`. A command is bound at admission to the link's `link_id` (stored in the
existing command `session_id` column, which always names the one delivery owner
allowed to claim it); `claim` returns at most two queued, unexpired commands
bound to the caller's current link. Commands never move between links, phones,
or bands, and legacy sessions never see 30-second wake commands.

### 3. Admission and wake (inside `requestWearableHaptic`)

Admission transaction: a live legacy session keeps today's path. Otherwise the
current link binds a command expiring in 30 seconds. Otherwise `unavailable`
(`device_disconnected` when the member has a push route, else today's
presence-based reason). Pending command -> `busy`, as today.

After commit, outside any transaction, only for a queued wake command and only
when the route belongs to the link's installation, on fixed reserved deadlines:
1. Observe the command for one poll interval (2.5 s); an open app claims it.
2. If still queued, send the background push (2 s bound).
3. Observe until 7 s; if still queued and `alerts_allowed`, send one alert (2 s).
4. `unregistered` deletes the route only where the attempted token still matches.
   Push outcomes never change a command: an unclaimed command expires truthfully.
5. Return the effective status. A retry of the same command key that finds it
   queued and unexpired re-runs the wake; claimed effects never replay. Rare
   concurrent retries may duplicate an alert; that is accepted.

### 4. iOS

- `WearableCommandDelivery` owns delivery: one `deliverPending(band)` (claim ->
  perform -> receipt) used by the two-second foreground timer, push wakes,
  notification taps, and link readiness; it owns the wake deadline and
  coalescing (a wake during an in-flight claim schedules one follow-up claim).
  Push, tap, and lifecycle handlers are thin adapters. `link`/`unlink` follow
  controller state; the legacy loop, its restart bug, and session ids go.
- Stable installation id in the device-only private Keychain; register for remote
  notifications once the member session is ready; upload the route with build
  environment and current `alertsAllowed`; refresh on token or settings change;
  delete on sign-out or consent loss. Request notification permission only from
  Connect device, explaining the fallback.
- Wake handling is reachable at launch: an absolute 25-second deadline covers
  credential read (after first unlock), Bluetooth restoration, claim, perform,
  and receipt; the OS callback completes after effects settle. Foreground alerts
  are consumed without a banner. Sign-out deletes the route before discarding
  credentials.
- Background Bluetooth: `bluetooth-central` and `remote-notification` modes;
  per-vendor long-lived central managers with restore identifiers recreated at
  launch, generation fencing instead of per-attempt managers, ready links kept
  across inactivity, `perform` allowed in the background with wake-sized
  timeouts, and re-handshake of restored peripherals.

## Risks and mitigations

1. Background pushes throttled or dropped: visible fallback when allowed,
   foreground timer as recovery, truthful status, TestFlight measurement.
2. Stale link after force-quit: 30-second expiry and truthful `expired`; the next
   `link` or route registration replaces it.
3. Rollback: removing APNs configuration disables pushes and keeps every wake
   action and foreground delivery. Once wake apps ship, the Web rollback floor is
   the first version with wake actions; the schema is additive.
4. App Review: background modes serve only the member's own band and requested
   reminders; review notes describe how to exercise them.

## Tasks

1. Web: additive migration, push-route endpoint, `apple-push`, wake actions and
   admission, export/deletion coverage, focused tests, docs.
2. Operator: APNs auth key, Push capability on both App IDs, Web env vars.
3. iOS: installation id, push registration, wake coordinator, unified delivery,
   background Bluetooth with restoration, tests, docs.
4. After device proof: update `murph.device` delivery wording.
5. After legacy apps age out: delete the poll actions, session table, and
   presence-based reasons.

## Decisions

- Silent first, visible fallback (member choice, 2026-10-05).
- Explicit wake capability; enrollment owned by the wearable link, push route
  only an address; commands bound to a link at admission; no long-lived lease
  (architecture reviews 1 and 2, 2026-10-05).
- Keep the foreground timer as recovery (architecture review, 2026-10-05).

## Verification

- Web: focused vitest for wearable haptics (legacy unchanged, wake admission,
  escalation, retry re-wake, conditional token cleanup, budget), push route, and
  apple-push with a fake transport; web typecheck.
- iOS: CI xcodebuild tests for delivery, wake coordinator deadlines, restoration;
  physical-device matrix above on a TestFlight build.

## Outcome

- Web (PR #4033): live legacy leases, short in-turn waits, wake actions, push
  route, Apple push sender, silent-first wake with visible fallback, and account
  deletion coverage. Dormant until APNs credentials are configured.
- iOS (`murph-ios` `feat/wearable-wake`): background Bluetooth, push
  registration, wake relay, and one serialized delivery pass.
- Follow-ups outside this plan: APNs key and Push capability provisioning,
  physical-device proof on a TestFlight build, `murph.device` delivery wording
  after that proof, measuring terminated-app wakes before adding Bluetooth state
  restoration, and deleting the poll actions once 1.1.21 apps age out.
Completed: 2026-10-05
