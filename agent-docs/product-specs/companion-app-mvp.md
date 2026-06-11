# iOS Companion App — MVP Build Spec

Last verified: 2026-06-10

Parent spec: `agent-docs/product-specs/companion-app.md` (strategy, phases,
review posture). This doc is the concrete build plan for the first shippable
slice.

## Scope: Two Screens

1. **Login** — Privy sign-in with phone or email OTP.
2. **Connect Apple Health** — one button that runs the HealthKit permission
   flow and starts Junction sync. After connecting, the same screen shows
   connected state and last-sync time.

Nothing else. No settings, no data browsing, no chat, no vault. Distribution
target is TestFlight (family challenge testers); the App-Store-ready deltas
are listed at the end and deliberately deferred.

### Login methods: verified constraint

Privy's Swift SDK natively supports **email OTP and SMS OTP**. Its native
OAuth support is currently **Google-only — Telegram login is web-only and
not available in the iOS SDK**. MVP therefore ships **phone + email**;
Telegram joins when Privy lands it on iOS (tracked as an open item, not
worked around).

Guideline note: Apple's 4.8 (must offer Sign in with Apple) is triggered by
third-party *social* login. Email/SMS OTP does not trigger it. The day we
add Telegram or Google, we must add Sign in with Apple in the same release.

## Stack (verified versions, 2026-06-10)

| Piece | Detail |
| --- | --- |
| UI | SwiftUI, `@main App` + `UIApplicationDelegateAdaptor` (Junction requires an AppDelegate hook) |
| Health | `vital-ios` 1.8.8 via SPM (`https://github.com/tryvital/vital-ios`), products `VitalCore` + `VitalHealthKit`; platform minimum iOS 14 |
| Auth | `privy-ios` via SPM (`https://github.com/privy-io/privy-ios`, binary XCFramework) |
| Deployment target | iOS 16 proposed (comfortably above both SDK floors; confirm Privy's exact floor at scaffold time) |
| Bundle ID | `ai.withmurph.app` |
| Repo placement | top-level `apps/ios`, outside the pnpm workspace graph |

## App Flow

```
Launch
  └─ AppDelegate.didFinishLaunching
       └─ VitalHealthKitClient.automaticConfiguration()   // mandatory, synchronous
  └─ PrivySdk.initialize(PrivyConfig(appId:, appClientId:))
       ├─ existing Privy session?  ──yes──▶ Connect screen
       └─ no ──▶ Login screen
Login screen
  └─ phone → privy.sms.sendCode(to:) → privy.sms.loginWithCode(_:sentTo:)
  └─ email → equivalent email OTP flow
  └─ success ──▶ token exchange (below) ──▶ Connect screen
Token exchange (once per install, repeatable on failure)
  └─ app sends Privy auth token to Murph web API
  └─ backend verifies Privy identity (@privy-io/node, already a dependency)
  └─ backend ensures the member's Junction user (junction-client already has
     resolve/createUser) and calls POST /v2/user/{user_id}/sign_in_token
  └─ app: try await VitalClient.signIn(withRawToken: token)
       // SDK exchanges the short-lived token for permanent OAuth credentials
       // stored on-device, then discards it — backend never stores it
Connect screen
  └─ [Connect Apple Health] button:
       1. VitalHealthKitClient.configure(.init(backgroundDeliveryEnabled: true))
       2. await VitalHealthKitClient.shared.ask(
            readPermissions: [.sleep, .activity, .workout, /* heart-rate +
            respiratory resources — finalize against the VitalResource enum
            at build time */],
            writePermissions: [])
       3. iOS shows the system HealthKit sheet → grant
  └─ connected state: "Connected ✓ · last synced <relative time>"
```

## Project Configuration (verified against Junction docs)

Entitlements:
- HealthKit, including **HealthKit Background Delivery**
- Background Modes → **Background Processing**

Info.plist:
- `NSHealthShareUsageDescription` — honest copy: Murph reads sleep, heart
  rate, respiratory, and workout data you choose to share, to set your
  baselines and score experiments you join.
- `BGTaskSchedulerPermittedIdentifiers` →
  `io.tryvital.VitalHealthKit.ProcessingTask`

## Backend Work (the only server change)

One new authenticated endpoint in `apps/web`, e.g.
`POST /api/device-sync/companion/sign-in-token`:

1. Authenticate the caller as a Murph member via their Privy auth token
   (server-side verification through the existing `@privy-io/node`
   dependency — no new auth system).
2. Resolve-or-create the member's Junction user via the existing
   `junction-client` (`resolveUser`/`createUser` already implemented).
3. Call Junction `POST /v2/user/{user_id}/sign_in_token` (needs a small
   addition to `junction-client`; follows its existing request patterns).
4. Return `{ signInToken }`. Do not log or persist the token; it is
   single-exchange and discarded by the SDK.

Data then lands in the **existing** Junction webhook → device-syncd
pipeline. No ingestion changes expected for MVP; the phase-1 spike question
(does Junction preserve per-source attribution for HealthKit-relayed WHOOP
data?) is answered by looking at what this pipeline receives.

## What "done" means (MVP acceptance)

- Fresh install → phone or email OTP login → one tap → HealthKit sheet →
  grant → Junction dashboard (sandbox) and Murph's pipeline show the
  member's sleep/RHR/respiratory/workout data, including WHOOP-relayed
  history.
- Kill the app, wait a day: background delivery lands new samples without
  opening the app (hour-to-day envelope per parent spec).
- Sign-out/in on a second device reaches connected state without backend
  changes.

## Deferred (explicitly out of MVP)

- Telegram login (blocked on Privy iOS SDK; re-check before App Store
  submission), Google/Apple login (4.8 pairing rule above).
- Sync-status detail screen, per-type toggles, disconnect/delete UI — these
  are the App Store 4.2 utility surface; TestFlight review does not demand
  them. Required before public App Store submission, along with the 2.5.1
  description, 5.1.3(i) data disclosure, privacy nutrition labels, and the
  open Apple AI-data-sharing disclosure question (parent spec).
- Android, BLE, widgets, Live Activities, watchOS (parent spec roadmap).

## Open Items

- Confirm Privy iOS SDK minimum deployment target at scaffold time.
- Finalize the exact `VitalResource` read set against the SDK enum (resting
  heart rate / heart rate / respiratory naming differs from product naming).
- Junction environment: point the app's first build at **sandbox** (matches
  hosted-local) and switch to production keys for TestFlight.
- Telegram-on-iOS support tracking with Privy.
