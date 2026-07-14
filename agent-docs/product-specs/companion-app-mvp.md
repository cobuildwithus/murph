# iOS Companion App — MVP Build Spec

Last verified: 2026-07-13

Parent spec: `agent-docs/product-specs/companion-app.md` (strategy, phases,
review posture). This doc is the concrete build plan for the first shippable
slice, revised after external architecture review (2026-06-10).

Framing rule: this is **an Apple Health sync companion, not a general Murph
mobile client**. Its durable responsibility is getting Apple Health data into
the existing device-syncd pipeline. Junction remains the broad sync path. One
narrow native exception reads WHOOP's `WHOOP Recovery` and `WHOOP Strain`
custom metadata because Junction and normal HealthKit quantity/category
mapping omit those values. The exception is closed to those two keys and does
not create a general native HealthKit ingestion engine.

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

For WHOOP members, the relay handoff uses WHOOP's documented menu path: **More
→ App Settings → Integrations → Apple Health → Connect**, then enable all
desired categories and tap **Allow** before connecting Apple Health in Murph.
WHOOP does not document a supported settings deep link, so Murph must not
fabricate one.

### Time-boxed Messages extension proof (explicit scope exception)

The 2026-07-10 Linq iMessage mini-app proof is a deliberate, isolated
exception to the two-screen Health sync MVP above. It may add one settings
control to the containing app and one Messages extension target, but it does
not make chat, polls, or mobile account state a new responsibility of the
companion app.

The proof has one question: can an installed Murph Messages extension perform
a Murph-account action whose authority originates from the containing app's
current Privy session? The smallest honest implementation is:

1. Linq delivers a single `imessage_app` card associated with the exact signed
   Murph Messages extension Team ID and bundle ID. Linq does not host the UI or
   receive button-tap webhooks.
2. The card URL is a capability-less first-party HTTPS locator containing only
   a public card identifier. It never contains a Privy token, derived
   credential, member ID, participant UUID, or health data.
3. The containing app, while Privy-authenticated, calls `POST
   /api/device-sync/companion/imessage-mini-app/enrollment`. The server verifies
   the bounded request body, verifies the identity token, then serializes with
   account deletion on the hosted-member lock while re-checking active access
   and launch consent. It returns a random 24-hour Messages-only bearer only
   after the Messages-domain-separated lookup hash is inserted in that same
   transaction.
4. The containing app writes only that derived bearer to an explicitly
   addressed shared Keychain access group. Privy's own access, refresh, and
   identity tokens remain in Privy's host-app-private storage.
5. The extension calls `POST
   /api/device-sync/companion/imessage-mini-app/proof-action` with the derived
   bearer and a closed, versioned choice envelope. The server re-checks active
   access and launch consent and returns the accepted choice. This spike does
   not persist a poll or imply durable product truth.
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
| Health | `vital-ios` 1.8.8 via SPM (`https://github.com/tryvital/vital-ios`), products **`VitalCore` + `VitalHealthKit` only** — never `VitalDevices` in v1 (separate enterprise license; BLE is out of scope anyway) |
| Auth | `privy-ios` via SPM (`https://github.com/privy-io/privy-ios`, binary XCFramework) |
| Deployment target | **iOS 17** (Privy Swift SDK floor is iOS 17+ / Xcode 16+, verified; vital-ios floor is iOS 14) |
| Bundle ID | `ai.withmurph.app` |
| Repo placement | separate native iOS repository; no local database, no general HealthKit reader, no challenge/scoring logic in the app; one bounded reader exists for the two approved WHOOP metadata keys |

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
       4. best-effort native enrichment reads only:
          - `WHOOP Recovery` from `.inBed` sleep-analysis samples
          - `WHOOP Strain` from workout samples
          It hashes the HealthKit sync identifier (UUID fallback) on-device,
          uploads at most 200 closed records per request, and never uploads a
          raw sample identifier or arbitrary metadata.
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

Three small endpoints in `apps/web`, all authenticated via Privy token
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
3. `POST /api/device-sync/companion/health-metadata`
   — accepts schema version 1 with 1–200 records, exact lower-case SHA-256
   record identities, required non-negative safe-integer sync versions, and
   only `recovery_score` / `workout_strain`. It
   validates finite ranges and timestamps against a 366-day history horizon
   and 24-hour future-clock allowance, then stores one bounded encrypted dirty
   payload on the member's active Junction runtime lane. That active
   member-owned connection is the ingestion authority; projected source rows
   are optional evidence used only to disambiguate multiple active Junction
   lanes, never a prerequisite for the fresh SDK-created lane. At most 16
   payloads may remain queued per connection; a full backlog returns retryable `429`.
   The mailbox wake contains no health values. `device-syncd` maps the closed
   batch to Junction sleep/activity summaries under Apple HealthKit provenance
   with an unverified WHOOP-metadata source hint, and `packages/importers` plus
   `packages/core` remain the only canonical write path.

### Deployment order and rollback floor

Current companion volume is low, so the iOS release is the rollout gate. Do not
add a runtime feature flag or capability handshake, and do not require an
immediate container rollout, queue drain, or tandem deploy. Deploy the
Cloudflare/device-syncd and Vercel/web changes through their normal backend
release paths, verify both, and release the iOS app last. After the iOS release,
keep both backend surfaces on feature-aware versions while supported clients
can upload companion metadata.

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
- Android, BLE (`VitalDevices`), widgets, Live Activities, watchOS (parent
  spec roadmap).
- No analytics events containing health payloads.

## Open Items

- Finalize the exact `VitalResource` read set against the SDK enum.
- Junction environment: first build on **sandbox** (matches hosted-local),
  production keys for TestFlight.
- Telegram-on-iOS support tracking with Privy.
- AGPL/commercial confirmation from Junction (gate above).
