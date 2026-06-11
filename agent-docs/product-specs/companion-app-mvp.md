# iOS Companion App — MVP Build Spec

Last verified: 2026-06-11

Parent spec: `agent-docs/product-specs/companion-app.md` (strategy, phases,
review posture). This doc is the concrete build plan for the first shippable
slice, revised after external architecture review (2026-06-10).

Framing rule: this is **an Apple Health sync companion, not a Murph mobile
client and not a WHOOP integration**. Its only durable responsibility is
getting Apple Health data into the existing Junction → device-syncd
pipeline. WHOOP is one important Apple Health writer among several; scoring
and baselines key off data categories, never vendor identity.

Growth framing: the nearest payoff is not WHOOP — it is **Apple Watch and
iPhone-health members, who currently cannot connect to Murph at all**
(`apple-health` is an `unavailableRoute` on the connect page today). The
WHOOP relay rides along. Constraint framing: company survival mode means
this build is **time-boxed at days, not weeks** of focused work; any scope
growth beyond this doc is a signal to stop and re-justify.

## Scope: Two Screens

1. **Login** — Privy sign-in with phone or email OTP.
2. **Connect Apple Health** — one button that runs the HealthKit permission
   flow and starts Junction sync, then shows honest backend-confirmed sync
   state.

Nothing else. No settings, no data browsing, no chat, no vault. Distribution
target is TestFlight (family challenge testers); App-Store-ready deltas are
listed at the end and deliberately deferred.

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
| Health | `vital-ios` 1.8.8 via SPM (`https://github.com/tryvital/vital-ios`), products **`VitalCore` + `VitalHealthKit` only** — never `VitalDevices` in v1 (separate enterprise license; BLE is out of scope anyway) |
| Auth | `privy-ios` via SPM (`https://github.com/privy-io/privy-ios`, binary XCFramework) |
| Deployment target | **iOS 17** (Privy Swift SDK floor is iOS 17+ / Xcode 16+, verified; vital-ios floor is iOS 14) |
| Bundle ID | `ai.withmurph.app` |
| Repo placement | top-level `apps/ios`, outside the pnpm workspace graph; no local database, no local HealthKit readers, no challenge/scoring logic in the app |

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
  └─ backend resolves/creates the member's Junction user (existing
     junction-client) and calls POST /v2/user/{user_id}/sign_in_token
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
  └─ status states (below), driven by backend evidence
```

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

The button after connect is **"Check for new data"** — opening the app is
itself the sync trigger (Junction syncs on every launch and on HealthKit
background wake; there is no manual `syncData()` call, verified) — the
button just refreshes backend status.

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

## Historical Backfill (verified, corrected)

Junction's Apple HealthKit ingestion defaults to **30 days** of history,
configurable to a **maximum of 365 days**. Full device-lifetime history in
the Apple Health store is NOT automatically ingested. Implications:

- Configure the pull range explicitly (365d covers current members'
  WHOOP-relay history; baselines need ~2 weeks minimum).
- Phase-1 spike measures actual received depth at default and configured
  settings; baseline sufficiency is a spike gate, not an assumption.

## Source Attribution (verified, resolved pessimistically)

Junction tags Apple Watch / iPhone / Apple Health app data, but **data
written by third-party apps (the WHOOP case) is tagged `source.type:
unknown`**; `source.app_id` exists on summary resources only, never on
timeseries. Therefore:

- Scoring and baselines are **source-agnostic** (data categories +
  confidence), with attribution as opportunistic debug metadata.
- Backend must expect duplicate/overlapping writers (Apple Watch + WHOOP
  both writing workouts/sleep) and dedupe or apply source-precedence
  server-side — spike includes an overlapping-writers test.

## Backend Work

Two small endpoints in `apps/web`, both authenticated via Privy token
verification (existing `@privy-io/node`):

1. `POST /api/device-sync/companion/sign-in-token`
   — resolve member → resolve/create Junction user (existing
   `junction-client`) → **ensure an active junction `device_connection`
   account bound to that Junction user id** → `POST
   /v2/user/{user_id}/sign_in_token` (small junction-client addition) →
   return once. Never persist or log the token (redaction test required).
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
   rate / respiratory), sourced from the existing pipeline. This is what the
   Connect screen renders.

### Why the account-ensure step is load-bearing (verified in repo)

Webhook ingestion resolves the account via
`getConnectionByExternalAccount`; **webhooks for a Junction user with no
matching `device_connection` record are delayed as orphans**
(`public-ingress.ts` "Delaying webhook for unknown device sync account").
The SDK flow has no Link callback to create that record, so the
sign-in-token endpoint must do it. Rules:

- Idempotent: resolve any existing junction account for the member first
  (a member with a prior Junction Link device shares the same Junction
  user) — re-creating identity is exactly what caused the June 2026
  duplicate-import incident; reuse its externalRef discipline.
- HealthKit data then projects automatically: `resolveJunctionOrigin` is
  slug-agnostic (verified), so `apple_health_kit` sources flow through
  `projectJunctionSources` without importer changes.
- Resource enablement: webhook jobs for resources outside the configured
  Junction resource set are skipped (with a reconcile-floor fallback) —
  confirm the HealthKit resource slugs fall inside
  `JUNCTION_ALLOWED_SUMMARY_RESOURCES` / `_TIMESERIES_RESOURCES` during the
  spike.
- The `apple-health` connect source on the web connect page stays
  `unavailableRoute` for MVP (it is a mobile flow); flipping its display to
  "use the iPhone app" copy is a fast-follow, not MVP.

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

## Deferred (explicitly out of MVP)

- Telegram login (Privy iOS gap), Google/Apple login (4.8 pairing rule).
- Sync-status detail screen, per-type toggles, disconnect/delete UI,
  support copy — the App Store 4.2 utility surface; required with the 2.5.1
  description, 5.1.3(i) specific-data disclosure, privacy nutrition labels,
  and explicit consent for third-party AI processing of synced health data
  (Apple's Nov 2025 guideline) before public submission.
- Android, BLE (`VitalDevices`), widgets, Live Activities, watchOS (parent
  spec roadmap).
- No analytics events containing health payloads.

## Open Items

- Finalize the exact `VitalResource` read set against the SDK enum.
- Junction environment: first build on **sandbox** (matches hosted-local),
  production keys for TestFlight.
- Telegram-on-iOS support tracking with Privy.
- AGPL/commercial confirmation from Junction (gate above).
