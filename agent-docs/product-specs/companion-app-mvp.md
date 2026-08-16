# iOS Companion App — MVP Build Spec

Last verified: 2026-07-14

Parent spec: `agent-docs/product-specs/companion-app.md` (strategy, phases,
review posture). This doc is the concrete build plan for the first shippable
slice, revised after external architecture review (2026-06-10).

Framing rule: this is **an Apple Health sync companion, not a general Murph
mobile client**. Its durable responsibility is getting Apple Health data into
the existing device-syncd pipeline. Junction remains the broad sync path. One
narrow native exception reads WHOOP's `WHOOP Recovery` and `WHOOP Strain`
custom metadata because Junction and normal HealthKit quantity/category
mapping omit those values. The exception is closed to those two keys and does
not create a general native HealthKit ingestion engine. A separately gated
internal beta path derives one overnight PRV RMSSD estimate from a WHOOP 5/MG
BLE pulse-interval stream; it does not change the source-agnostic Apple Health
sync or claim parity with clinical ECG HRV, WHOOP's proprietary overnight HRV,
or WHOOP Recovery.

Growth framing: the nearest payoff is not WHOOP — it is **Apple Watch and
iPhone-health members**. Apple Health remains a native-only authorization flow;
the web connect page and direct Murph conversation now hand members to the
approved iOS app rather than presenting Apple Health as unavailable. The WHOOP
relay rides along. Constraint framing: company survival mode means
this build is **time-boxed at days, not weeks** of focused work; any scope
growth beyond this doc is a signal to stop and re-justify.

## Scope: Two Screens

1. **Login** — Privy sign-in with phone or email OTP.
2. **Connect Apple Health** — one button that runs the HealthKit permission
   flow and starts Junction sync, then shows honest backend-confirmed sync
   state.

Nothing else. No settings, no data browsing, no chat, no vault. The app is now
approved for public App Store distribution at
`https://apps.apple.com/us/app/murph-ai/id6786145859`.

The separately gated direct-WHOOP beta adds one control to the existing Connect
screen, not another workflow: **Connect WHOOP** explicitly enrolls only the
local CoreBluetooth band and requests local-notification permission once. It
does not send hosted Junction `connectionIntent: "connect"`. After that, the
app continuously subscribes and measures the fixed local `00:00–08:00` window
automatically. There is no nightly Start/Finish action. The member may
background Murph or lock the phone, but force-quitting prevents iOS from
relaunching the BLE app until the member opens it again; one local watchdog
reminder handles that exception.

For WHOOP members, the relay handoff uses WHOOP's documented menu path: **More
→ App Settings → Integrations → Apple Health → Connect**, then enable all
desired categories and tap **Allow** before connecting Apple Health in Murph.
WHOOP does not document a supported settings deep link, so Murph must not
fabricate one.

### Messages extension action bridge (explicit scope exception)

The Messages mini-app bridge is a deliberate, isolated
exception to the two-screen Health sync MVP above. It may add one settings
integration to the containing app and one Messages extension target, but it does
not make chat, polls, or mobile account state a new responsibility of the
companion app.

The bridge lets an installed Murph Messages extension perform a bounded
Murph-account action whose authority originates from the containing app's
current Privy session. The smallest honest implementation is:

1. Linq delivers a single `imessage_app` card associated with the exact signed
   Murph Messages extension Team ID and bundle ID. Linq does not host the UI or
   receive button-tap webhooks.
2. The card URL is a capability-less first-party HTTPS presentation snapshot.
   It never contains a Privy token, derived credential, member ID, participant
   UUID, canonical record ID, or write authority.
3. The containing app, while Privy-authenticated, calls `POST
   /api/device-sync/companion/imessage-mini-app/enrollment`. The server verifies
   the bounded request body, verifies the identity token, then serializes with
   account deletion on the hosted-member lock while re-checking active access
   and launch consent. It returns a random 24-hour Messages-only bearer only
   after atomically rotating one deterministic Messages-owned session row in
   that same transaction. Repeated enrollment replaces the lookup hash and
   invalidates the prior bearer while keeping storage bounded to one Messages
   row per member and leaving ordinary device-agent rows untouched.
4. The containing app writes only that derived bearer to an explicitly
   addressed shared Keychain access group. Privy's own access, refresh, and
   identity tokens remain in Privy's host-app-private storage.
5. The extension calls `POST
   /api/device-sync/companion/imessage-mini-app/member-actions` with the derived
   bearer and a closed, bounded, versioned action envelope. The server derives
   the member, re-checks active access and historical launch consent, and
   appends the request to the existing encrypted mailbox before returning
   `202 Accepted`. The runtime dispatches it directly to the existing domain
   use case with no assistant turn. Workout is the first action family; future
   editors extend the closed union rather than gaining arbitrary patch or tool
   authority.
6. Disabling the feature or signing out calls `DELETE
   /api/device-sync/companion/imessage-mini-app/enrollment` best-effort and
   always clears the local derived bearer, even if the network revoke fails.

Privy Swift 2.12.0 is intentionally absent from the extension target: its
binary references app-only lifecycle APIs, is not marked app-extension-safe,
and provides no supported shared-storage adapter. Adding Keychain entitlements
does not make that SDK safe to link and must not expose its raw session.

The Linq development-build path remains an empirical gate. Apple supports
developer-signed containing apps and extensions, and Linq identifies an app
card by Team ID plus extension bundle ID with an optional App Store ID, but a
physical-device send is still required to prove Linq renders a directly
installed build rather than the static fallback.

### Login methods: verified constraint

Privy's Swift SDK natively supports **email OTP and SMS OTP**. Its native
OAuth support is currently **Google-only — Telegram login is web-only and
not available in the iOS SDK**. MVP ships **phone + email**; Telegram joins
when Privy lands it on iOS.

Guideline note: Apple's 4.8 (must offer Sign in with Apple) is triggered by
third-party *social* login. Email/SMS OTP does not trigger it. The day we
add Telegram or Google, we must add Sign in with Apple in the same release.

## Stack (verified 2026-06-10)

| Piece | Detail |
| --- | --- |
| UI | SwiftUI, `@main App` + `UIApplicationDelegateAdaptor` (Junction requires an AppDelegate hook) |
| Health | `vital-ios` 1.8.8 via SPM (`https://github.com/tryvital/vital-ios`), products **`VitalCore` + `VitalHealthKit` only** — never `VitalDevices` in v1 (separate enterprise license); the gated WHOOP beta uses its own narrow CoreBluetooth transport |
| Auth | `privy-ios` via SPM (`https://github.com/privy-io/privy-ios`, binary XCFramework) |
| Deployment target | **iOS 17** (Privy Swift SDK floor is iOS 17+ / Xcode 16+, verified; vital-ios floor is iOS 14) |
| Bundle ID | `ai.withmurph.app` |
| Repo placement | separate native iOS repository; no local database, no general HealthKit reader, no challenge/scoring logic in the app; one bounded reader exists for the two approved WHOOP metadata keys, and the WHOOP BLE beta uses one OS-protected versioned state file for its scalar checkpoint, three-envelope outbox, and exact app-scoped CoreBluetooth peripheral UUID |

### Licensing gate (ship/no-ship)

`vital-ios` core is **AGPLv3** (verified in the repo LICENSE; `VitalDevices`
is separately enterprise-licensed). Embedding AGPL code in a closed-source
distributed app requires a commercial license. **Before TestFlight:** obtain
written confirmation from Junction that Murph's plan covers commercial
mobile SDK use. Tracked as a hard gate, not an implementation detail.

## App Flow

```
Launch
  └─ AppDelegate.didFinishLaunching
       └─ VitalHealthKitClient.automaticConfiguration()   // mandatory, synchronous
  └─ PrivySdk.initialize(PrivyConfig(appId:, appClientId:))
  └─ session reconciliation (per Junction guidance — do NOT fetch a fresh
     sign-in token every launch):
       ├─ Privy signed out                      → Junction signOut if needed → Login
       ├─ Privy signed in + Junction signed in  → Connect/status screen
       └─ Privy signed in + Junction signed out → token exchange → Connect
  └─ account-switch guard: if the Privy member differs from the member the
     Junction session was created for, force Junction signOut + re-exchange
Login screen
  └─ phone → privy.sms.sendCode(to:) → privy.sms.loginWithCode(_:sentTo:)
  └─ email → equivalent email OTP flow
Token exchange (on demand, immediately before SDK exchange; retry = new token)
  └─ app sends Privy auth token to Murph web API
  └─ backend verifies Privy identity (@privy-io/node, already a dependency)
  └─ backend applies intent against durable Junction state: known same-member
     passive repair sends resume and requires exactly one established row;
     fresh/unproven install omits intent, resuming exactly one established row
     or establishing only when zero provider rows exist; terminal or ambiguous
     state rejects; only a future visible hosted reconnect may send connect
  └─ backend calls POST /v2/user/{user_id}/sign_in_token for the selected lane
  └─ app: try await VitalClient.signIn(withRawToken: token)
       // SDK exchanges the short-lived token for on-device credentials,
       // then discards it — backend never stores or logs it
Connect screen
  └─ [Connect Apple Health] button:
       1. VitalHealthKitClient.configure(.init(
            backgroundDeliveryEnabled: true,
            connectionPolicy: .explicit))   // deliberate user action, not auto
       2. await VitalHealthKitClient.shared.ask(
            readPermissions: [.sleep, .activity, .workout, /* heart-rate +
            respiratory resources — finalize against the VitalResource enum
            at build time */],
            writePermissions: [])
       3. iOS shows the system HealthKit sheet
       4. best-effort native enrichment reads only:
          - `WHOOP Recovery` from `.inBed` sleep-analysis samples
          - `WHOOP Strain` from workout samples
          It hashes the HealthKit sync identifier (UUID fallback) on-device,
          uploads at most 200 closed records per request, and never uploads a
          raw sample identifier or arbitrary metadata.
  └─ [Connect WHOOP] internal-beta control:
       1. enroll exactly one local band and request local-notification permission
          without sending hosted `connectionIntent: "connect"`
       2. keep the BLE subscription active and automatically reduce only the
          fixed local `00:00–08:00` window
  └─ status states (below), driven by backend evidence
```

Passive Junction SDK sign-in repair is a separate lifecycle path, not an effect
of the Connect WHOOP control. Its authority rules are defined under Backend Work.

### Sync-status states (backend evidence is the truth)

Apple deliberately hides whether HealthKit *read* permission was granted —
after `ask()` the app must assume zero knowledge. "Connected" can only mean
"the backend has received data." UI states:

| State | Meaning |
| --- | --- |
| Not connected | Health flow not started |
| Access requested · waiting for first data | Sheet completed; actual permission unknown |
| Synced · last data received <relative time> | Backend confirmed receipt (status endpoint) |
| Delayed | No new data inside the expected envelope |
| Needs attention | Prolonged silence (revoked-permission symptom) → guide to Health settings; chat nudge fires server-side |

The button after connect is **"Check for new data"**. Opening or foregrounding
the app triggers the bounded native enrichment and Junction's launch sync;
the button performs the same best-effort enrichment before refreshing backend
status. There is no Junction manual `syncData()` call.

## Background Sync Behavior (verified, corrected)

- Junction documents that the Background Delivery subscription **persists
  even if the user never opens the app, force-quits it, or restarts the
  iPhone**. (HealthKit background delivery is an exception to the usual
  iOS force-quit rule.)
- Cadence remains **hourly-advisory, hour-to-day in practice** — iOS defers
  on battery, CPU, connectivity, Low Power Mode. Treat persistence claims as
  best-effort and verify empirically over 24–48h (incl. force-quit + reboot)
  in the phase-1 spike before relying on them in product copy.
- Server-side staleness detection + the existing chat channel is the
  recovery mechanism: data goes quiet → referee nudges in chat → member
  opens the app → launch sync fires immediately.
- The two custom metadata values are foreground/launch enrichment in this
  slice. They must not be described as background-automatic until a separate
  anchored-query/background-delivery design persists and tests anchors,
  deletions, authorization readiness, and callback completion.

## Historical Backfill (verified, corrected)

Junction's Apple HealthKit ingestion defaults to **30 days** of history,
configurable to a **maximum of 365 days**. Full device-lifetime history in
the Apple Health store is NOT automatically ingested. Implications:

- Configure the pull range explicitly (365d covers current members'
  WHOOP-relay history; baselines need ~2 weeks minimum).
- Phase-1 spike measures actual received depth at default and configured
  settings; baseline sufficiency is a spike gate, not an assumption.

## Source Attribution (verified, resolved pessimistically)

Junction tags Apple Watch / iPhone / Apple Health app data, but ordinary data
written by third-party apps may have weak attribution. The native enrichment
selects two exact metadata keys associated with WHOOP, but neither the client
nor server can attest who wrote them. Canonical provenance therefore remains
Apple HealthKit with an explicit unverified WHOOP-metadata hint. Therefore:

- Scoring and baselines are **source-agnostic** (data categories +
  confidence), with attribution as opportunistic debug metadata.
- Backend must expect duplicate/overlapping writers (Apple Watch + WHOOP
  both writing workouts/sleep) and dedupe or apply source-precedence
  server-side — spike includes an overlapping-writers test.

## Backend Work

Four small endpoints in `apps/web`, all authenticated via Privy token
verification (existing `@privy-io/node`):

1. `POST /api/device-sync/companion/sign-in-token`
   — resolve member → apply lifecycle intent against durable connection state →
   resume the established Junction user or conditionally establish the first
   one through the existing `junction-client` → `POST
   /v2/user/{user_id}/sign_in_token` → return once. Never persist or log the
   token (redaction test required).
   The local direct-BLE Connect WHOOP action sends no hosted lifecycle intent;
   it only enrolls the CoreBluetooth band. A known same-member passive SDK
   repair sends `connectionIntent: "resume"` and requires exactly one
   already-established member-owned Junction connection. A fresh or unproven
   installation omits intent so durable server state decides: exactly one
   established row resumes, zero provider rows establish the first lane, and
   terminal or ambiguous state rejects without mutation. Only a future visible
   hosted-health/Junction Reconnect action may send
   `connectionIntent: "connect"` and ensure/reactivate the Junction
   `device_connection`. Neither resume nor omitted intent may reverse a durable
   disconnect.
   Sandbox/prod must be impossible to mix (the junction client validates the
   API key prefix against the configured environment and returns the active
   environment in the response). Request body carries `appInstallationId`,
   app/SDK versions; the once-considered `companion_installations` record is
   **deferred until operationally needed** (simplicity: it carries no
   load-bearing behavior for the MVP) — the backend validates the body shape
   and discards the metadata without persisting or logging it. Rate limiting
   is also deferred: the hosted app has no rate-limiting layer for
   authenticated routes today and this change does not invent one; the
   existing Privy verification is the auth boundary.
2. `GET /api/device-sync/companion/status`
   — last data receipt overall and per resource (sleep / workouts / heart
   rate / respiratory), sourced from the existing pipeline, plus server
   `observedAt` for the snapshot. Native clients use that server clock for
   setup age, receipt freshness, and relative-time copy; a fresh connection
   requires a receipt that strictly advances the receipt observed immediately
   before the explicit connect. This is what the Connect screen renders.
3. `POST /api/device-sync/companion/health-metadata`
   — accepts schema version 1 with 1–200 records, exact lower-case SHA-256
   record identities, required non-negative safe-integer sync versions, and
   only `recovery_score` / `workout_strain`. It
   validates finite ranges and timestamps against a 366-day history horizon
   and 24-hour future-clock allowance, then stores one bounded encrypted dirty
   payload on the member's active Junction runtime lane. That active
   member-owned connection is the ingestion authority; projected source rows
   are optional evidence used only to disambiguate multiple active Junction
   lanes, never a prerequisite for the zero-provider-row omitted-intent
   bootstrap. At most 16 payloads may remain queued per connection; a full
   backlog returns retryable `429`.
   The mailbox wake contains no health values. `device-syncd` maps the closed
   batch to Junction sleep/activity summaries under Apple HealthKit provenance
   with an unverified WHOOP-metadata source hint, and `packages/importers` plus
   `packages/core` remain the only canonical write path.

### Deployment order and rollback floor

Current companion volume is low, so the iOS release is the rollout gate. Do not
add a runtime feature flag or per-request availability probe, and do not require
an immediate container rollout, queue drain, or tandem deploy. Deploy the
Cloudflare/device-syncd and Vercel/web changes through their normal backend
release paths, verify both, and release the iOS app last. After the iOS release,
keep both backend surfaces on feature-aware versions while supported clients
can upload companion metadata.
4. `POST /api/device-sync/companion/hrv-rmssd`
   — accept only the strict, sub-512-byte
   `murph.companion.overnight-prv-rmssd.v1` summary. After explicit enrollment,
   the phone continuously subscribes to the WHOOP 5/MG pulse-interval stream
   and automatically evaluates a fixed `00:00–08:00` local civil-time window.
   The schedule freezes that night's timezone rules, so a timezone change does
   not move an in-progress or retained occurrence. A fully traversed occurrence
   is bounded to 84...108 completed five-minute windows: typically 84, 96, or
   108, with intermediate counts such as 90 or 102 for half-hour transitions.
   The phone requires 240–300 seconds of
   pair-supported interval coverage inside each accepted window and computes
   the equal-weight mean of accepted window RMSSDs. It uploads exactly `schema`,
   `methodVersion`, `nightDate`, `rmssdMs`, `completedWindowCount`, and
   `acceptedWindowCount`; the completed count covers full attempted five-minute
   windows. The sole accepted method is
   `prv-rmssd-5m-mean-scheduled-0000-0800-local-v1`. At least 48 windows must be
   accepted and at least half of completed windows must qualify; completed
   windows must remain within the schedule-derived 84...108 bound. Per-window
   duration is phone algorithm policy; the backend does not reconstruct or falsely
   revalidate it. A BLE disconnect hard-breaks interval adjacency and the
   current window segment. Reconnect may continue the same scheduled night,
   but no interval or window crosses the gap;
   the final coverage gates decide whether the night qualifies. The only
   process-restorable health-derived state is one schema-versioned,
   OS-protected scalar checkpoint limited to frozen schedule/night identity,
   next window position, completed/accepted counts, and accepted-RMSSD sum,
   plus at most three already-derived strict-envelope outbox entries. The
   exact app-scoped CoreBluetooth peripheral UUID may persist in the same
   protected file solely to restore the enrolled band; it never uploads or
   enters logs. The incomplete current window is discarded across a process
   gap; intervals, partial-window state, per-window values, WHOOP account
   identity, and every other band identifier remain memory-only. One local
   watchdog notification is continually postponed while BLE callbacks are
   healthy and may remind the member to reopen Murph when they stop. Normal
   backgrounding or phone locking requires no action; force-quit prevents BLE
   relaunch until the app is opened again. The backend owns no capture scheduler.

   The contract has no exact capture timestamp, capture duration, timezone
   offset, coverage milliseconds, raw R-R interval, BLE packet, packet
   timestamp, heart-rate sample, per-window value, device identity, Apple
   Health value, or WHOOP account field; unknown fields fail. Reuse the one
   active member-owned Junction connection selected by the sign-in authority
   rules above,
   stage one compact encrypted dirty payload, and wake the existing hosted runtime.
   Missing, terminal, disconnecting, or ambiguous connection state fails
   closed; data ingress and outbox retry never establish or reactivate an
   account. Local band disconnect or sign-out disables BLE resume and clears
   local enrollment, checkpoint, peripheral UUID, and unsent outbox state after
   band cleanup without silently changing hosted connection state.

   The first accepted strict envelope owns `(connection, nightDate)` for 30
   days. A sparse web receipt containing only member/connection binding, hashed
   receipt id, strict-envelope hash, and creation time makes exact replay a
   no-op before first-admission freshness and connection gates; changed content
   conflicts. Receipts are excluded from workspace snapshots, lazily expire
   through the indexed owner/connection/time path, and are capped at 64 per
   connection. Each accepted envelope carries a verified SHA-256 admission
   identity through encrypted staging, the same local retry row, Junction
   normalization, and canonical external identity. Yield, lease expiry,
   retryable failure, hosted refetch, cold restore, or later disconnect retains
   that payload and row. Only canonical success or the exact structurally
   invalid terminal result acknowledges the hosted payload.

   Receipt cardinality is connection plus `nightDate`; canonical cardinality is
   vault plus source (`whoop`) plus `nightDate`. Runtime import writes one
   immutable summary-grain `whoop-ble-overnight-prv-rmssd` observation with a
   synthetic 12:00Z `occurredAt`, no event `timeZone`, and no fabricated
   capture timestamp. It has no generic `hrv` or biomarker alias. This beta
   wellness PRV estimate remains distinct from Apple HealthKit `hrv-sdnn` and
   the existing selected daily provider `hrv-rmssd` series containing WHOOP
   Recovery, Oura, or other provider evidence.

### Direct overnight PRV deployment order and rollback floor

Deploy the Cloudflare runtime first with `container_rollout=immediate`, require
managed-container smoke to report the new runner-bundle fingerprint, and pass a
functional compact-observation import smoke. Then deploy web acceptance and
resume/omitted-intent/future-connect lifecycle authority and release iOS last.
The local direct-BLE enrollment control sends no hosted `connect`. Before iOS
distribution, a signed physical iPhone must pass a continuous-subscription and
overnight WHOOP 5/MG capture-to-query test, including background, reconnect,
force-quit-watchdog, DST, and timezone-change cases. Network/log inspection must
prove the forbidden raw data is absent, and paired-ECG validation must support
the beta method. Do not probe runtime availability on each request. Once an iOS
client emits the scheduled method, runtime and web support are the rollback
floor until those clients and all staged envelopes drain. Roll back in reverse
order: stop iOS distribution, drain staged work before removing web acceptance,
then remove runtime support. This explicit order does not change the metadata
lane's iOS-last rollout above.

### Why conditional account ensure is load-bearing (verified in repo)

Webhook ingestion resolves the account via
`getConnectionByExternalAccount`; **webhooks for a Junction user with no
matching `device_connection` record are delayed as orphans**
(`public-ingress.ts` "Delaying webhook for unknown device sync account").
The SDK flow has no Link callback to create that record, so the
sign-in-token endpoint must establish it only for zero-row omitted-intent
bootstrap or a future explicit hosted reconnect. `resume`, terminal state, and
ambiguous state must never create a replacement. Rules:

- Idempotent: resolve any existing junction account for the member first
  (a member with a prior Junction Link device shares the same Junction
  user) — re-creating identity is exactly what caused the June 2026
  duplicate-import incident; reuse its externalRef discipline.
- HealthKit data then projects automatically: `resolveJunctionOrigin` is
  slug-agnostic (verified), so `apple_health_kit` sources flow through
  `projectJunctionSources` without importer changes.
- Native metadata enrichment deliberately reuses the same hosted Junction
  runtime lane instead of creating a second device account or letting
  `apps/web` write vault data. Its versioned payload is parsed again in
  `device-syncd`; record identity excludes mutable sync version so replays skip
  and updates revise the same canonical fact.
- Resource enablement: webhook jobs for resources outside the configured
  Junction resource set are skipped (with a reconcile-floor fallback) —
  confirm the HealthKit resource slugs fall inside
  `JUNCTION_ALLOWED_SUMMARY_RESOURCES` / `_TIMESERIES_RESOURCES` during the
  spike.
- The `apple-health` connect source on the web connect page stays outside the
  browser authorization routes because it is a native mobile flow. Its active
  App Store handoff opens the approved iOS app listing; the assistant may send
  the same canonical listing in a direct conversation. HealthKit permission
  still happens only inside the app.

Importer idempotency + day-level recompute for late-arriving sleep edits
are existing-pipeline concerns to confirm during the spike.

## Phase-1 Spike Gates (before MVP build is "real")

1. Compiles on iOS 17 with pinned Privy + vital-ios versions.
2. Privy email + SMS OTP on a real device.
3. Sign-in token exchange works; tokens never logged (verified by test).
4. Junction session persists across relaunch; account-switch forces clean
   re-sign-in; no duplicate Junction users on reinstall.
5. Sleep, workouts, heart-rate/RHR-equivalent, respiratory (if present)
   arrive in Junction sandbox and Murph's pipeline from a real device —
   specifically: the first webhook is **accepted, not orphan-delayed**
   (account-ensure works), and the HealthKit resource slugs are inside the
   enabled-resource config.
6. Historical depth measured at default and 365d-configured settings;
   sufficient for baselines.
7. Attribution fields inspected in real webhook payloads; overlapping
   Apple Watch + WHOOP writes examined for dedupe behavior.
8. Background delivery observed over 24–48h including force-quit and
   reboot.
9. Junction commercial-license confirmation in writing (AGPL gate).
10. On-device proof that another app can read both custom metadata keys,
    sends no raw identifiers, and lands Recovery plus workout Strain through
    the canonical importer path. Denied read permission must behave as an
    empty best-effort enrichment without downgrading Junction sync state.
11. Internal WHOOP beta proof: one explicit Connect WHOOP action survives
    ordinary relaunch/background restoration without re-enrollment; a signed
    device completes the fixed-window capture across ordinary, one-hour DST,
    and half-hour transition shapes; timezone change preserves the frozen night;
    disconnect gaps break adjacency; force-quit allows the already-scheduled
    watchdog reminder but no false claim of continued capture; and reopen
    restores only the locally enrolled band. The test must separately prove
    known-member `resume`, fresh-install omitted-intent inference, and rejection
    of terminal/ambiguous hosted state without sending `connect`.
12. Crash/relaunch proof reads back only the protected scalar checkpoint and
    at most three strict six-field envelopes, plus the exact app-scoped
    CoreBluetooth peripheral UUID. The UUID never leaves protected local state;
    network and logs contain no band identifier, while persisted state, network,
    and logs contain no raw BLE packet, interval, per-window value, exact capture
    timestamp, or timezone detail.

## No-Go Conditions

Stop and reconsider the architecture if the spike shows: backfill too
shallow for credible baselines; background latency incompatible with daily
challenge mechanics; overlapping-writer dedupe intractable server-side; or
licensing unresolved.

## TestFlight MVP Acceptance

1. Fresh install → OTP login → one tap → HealthKit sheet → backend status
   shows first data receipt.
2. App states are honest (waiting / synced / delayed / needs attention) and
   driven by the status endpoint, not local SDK optimism.
3. Background samples land with the app unopened over a multi-day window.
4. Logs redact Privy tokens, Junction tokens, and health payloads.
5. Sandbox/prod environment unambiguous in app and backend.
6. Recovery and workout Strain appear after a foreground sync; exact replay
   produces no duplicate canonical facts.

## Deferred (explicitly out of MVP)

- Telegram login (Privy iOS gap), Google/Apple login (4.8 pairing rule).
- Sync-status detail screen, per-type toggles, disconnect/delete UI,
  support copy — the App Store 4.2 utility surface; required with the 2.5.1
  description, 5.1.3(i) specific-data disclosure, privacy nutrition labels,
  and explicit consent for third-party AI processing of synced health data
  (Apple's Nov 2025 guideline) before public submission.
- Android, `VitalDevices`, widgets, Live Activities, watchOS, and WHOOP
  historical offload (parent spec roadmap). The narrow CoreBluetooth automatic
  overnight beta above does not make a generic wearable background service.
- No analytics events containing health payloads.

## Open Items

- Finalize the exact `VitalResource` read set against the SDK enum.
- Junction environment: first build on **sandbox** (matches hosted-local),
  production keys for TestFlight.
- Telegram-on-iOS support tracking with Privy.
- AGPL/commercial confirmation from Junction (gate above).
