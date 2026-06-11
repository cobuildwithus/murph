# iOS Companion App (Health Sync)

Last verified: 2026-06-10

## Why This Exists

WHOOP gates API access behind a discretionary app-approval process. Every
aggregator (Junction, Terra, Rook) is BYOO for WHOOP — the requirement is
contractual in WHOOP's API Terms (no credential sharing or sublicensing), so
no vendor switch avoids it. Unapproved apps are capped at 10 WHOOP members,
approval takes weeks-to-months with no published cadence, and WHOOP's terms
prohibit apps that "compete, directly or indirectly … in any manner" with
at-will termination. Building challenge growth on WHOOP's goodwill is a
single point of failure.

The WHOOP iOS app writes to Apple Health, verified empirically on a real
member device (2026-06-10): sleep intervals, resting heart rate, respiratory
rate, and workouts (duration, active energy, average heart rate) all flow
through, **including full historical backfill to device purchase**. Not
available via the relay: HRV, recovery %, and strain scores (WHOOP's
proprietary layer). Sleep exports as asleep/awake without the 5-stage
breakdown.

A thin iOS companion app that reads Apple Health and feeds the existing
Junction pipeline removes WHOOP's veto from the critical path, covers every
wearable that writes to Apple Health (Apple Watch included — no OAuth
integration exists for it today), and keeps members on their normal
WHOOP-app-plus-Bluetooth flow.

## Strategic Posture (Hybrid)

1. **Companion app is the backbone.** Baselines and challenge scoring use
   sleep + RHR (+ workouts), all relay-available. Nothing in the challenge
   wedge depends on WHOOP-proprietary scores.
2. **WHOOP API approval is an enrichment, never a dependency.** The Junction
   `whoop_v2` BYOO integration stays; if approval lands it upgrades fidelity
   (HRV, recovery, webhooks, richer sleep stages) for members who connect it.
   The 10-member cap covers current beta scale meanwhile.
3. **Android is deferred deliberately.** Non-iOS wearable members are mostly
   covered by existing server-side OAuth integrations (Oura, Garmin, Strava).
   The only uncovered slice is WHOOP-on-Android, small in an iPhone-skewed
   WHOOP base, and coverable later by the API path or a Kotlin app.

## Architecture Decision: Native Swift

SwiftUI + Junction `vital-ios` (SPM) + Privy `privy-ios` for auth (same Privy
app and user identities as the web vault).

Why native over React Native/Expo (both paths were researched and are
viable — Junction maintains first-class bindings for all four frameworks):

- The relay function is inherently iOS-only, so the cross-platform argument
  mostly evaporates (see Android posture above).
- The roadmap is native-shaped: BLE features (WHOOP straps broadcast heart
  rate over the standard BLE HR profile — live group-workout features),
  Live Activities / widgets for challenge scores, eventual watchOS. Serious
  CoreBluetooth work (background modes, state restoration) is where native
  meaningfully beats bindings.
- Junction's RN/Flutter packages are thin wrappers over `vital-ios` anyway;
  background-sync reliability lives in the native SDK under every option.
- Costs accepted: no TS type-sharing with the monorepo (mitigate by
  generating Swift types from the API schema), no JS-layer OTA updates
  (TestFlight/App Store cycles), a second codebase if Android-WHOOP demand
  ever materializes pre-approval.

## Data Capture Posture (durable guidance, 2026-06-11)

Connect once, capture everything useful. A member who connects Murph
should never have to wonder whether some category of their health data
was silently ignored: the default posture is to request and land **as
much sparse data as possible**, so Murph can be as useful as possible
from day one. Constraints that keep this safe and maintainable:

1. **Sparse lands; bulk gets summarized.** Daily/nightly/event-grain data
   (sleep, body, VO2max, BP readings, mindful sessions, nutrition events)
   is always welcome in the vault. High-frequency raw streams
   (per-second/per-minute series) must NOT land as raw dumps: aggregate
   in memory at import time and store the daily summary observation.
   Megabytes-per-member-month of raw is the smell test.
2. **Permission breadth is decoupled from import volume.** The companion
   app requests broad HealthKit read permissions (granting costs
   nothing); the importer's resource allowlist plus bounded mappings are
   the actual size gate. Widening a grant never obligates an import.
3. **New data kinds get real homes.** When a captured kind has no
   canonical vault store (e.g. ECG traces), adding a new vault surface /
   store / CLI seam is the right move — provided it is minimal,
   composable, and designed as a good primitive, not a dumping ground.
4. The utmost priority remains clean, simple, long-term maintainable and
   composable architecture with minimal complexity. Capture breadth never
   justifies architectural sprawl.

## Sync Behavior and Product Constraints

- HealthKit background delivery is hourly-advisory; iOS defers on battery,
  CPU, connectivity, and Low Power Mode. Real latency envelope is
  **one hour to one day**. Foreground delivery is immediate.
- Design scoring and referee dispatches around the envelope ("yesterday's
  sleep scores this morning"), never around real-time arrival.
- Junction documents that its Background Delivery subscription persists
  through force-quit and device restart (HealthKit background delivery is
  an exception to the usual iOS force-quit rule). Treat as best-effort and
  verify empirically in the phase-1 spike; server-side staleness detection
  plus the existing chat channel is the recovery path either way.
- The app must surface honest, backend-confirmed sync state (Apple hides
  HealthKit read-permission status by design — only data receipt proves a
  connection). Opening the app triggers an immediate launch sync; there is
  no manual sync API.

## MVP Scope (v1, App Store reviewable)

> Build plan narrowed 2026-06-10: the first shippable slice is two screens
> (Privy login + Connect Apple Health) targeting TestFlight; see
> `agent-docs/product-specs/companion-app-mvp.md`. The list below remains
> the App-Store-ready surface.

1. **Sign-in** via Privy linking to the member's existing Murph account.
2. **HealthKit permission flow** — native UI, purpose copy matching Murph's
   actual use (`NSHealthShareUsageDescription`).
3. **Junction Health SDK wiring** — Background Delivery + Background
   Processing entitlements, `BGTaskSchedulerPermittedIdentifiers` with
   `io.tryvital.VitalHealthKit.ProcessingTask`, sign-in token exchange into
   the existing Junction user pipeline.
4. **Sync-status home screen** — connection state, last sync time, per-type
   summary of recently synced data. This is the guideline-4.2 utility
   surface; not a webview.
5. **Settings** — per-data-type toggles, disconnect, delete-my-data.
6. **"Sync now"** foreground affordance + periodic-sync expectations copy.

Out of scope for v1: chat surfaces, vault UI, BLE, widgets, Live Activities,
watchOS, Android.

### App Store review requirements (verified June 2026)

- 4.2 minimum functionality: real native UI (the sync-status screen).
- 2.5.1: App Store description must state the HealthKit integration.
- 5.1.3(i): disclose the specific health data collected; never use health
  data for advertising/marketing; privacy nutrition labels consistent with
  the disclosure. Backend upload via Junction (processor) is permitted with
  consent and disclosure.
- Open question: Apple's Nov 2025 guideline update added third-party AI
  data-sharing disclosure requirements — Murph's AI use of synced health
  data may require additional disclosure/consent UI. Resolve before
  submission, not before building.

## Phases

| Phase | Contents | Gate |
| --- | --- | --- |
| 0. Apple setup | D-U-N-S (requested 2026-06-10), org enrollment, Xcode install | D-U-N-S ~5 business days; dev unblocked via free personal team |
| 1. Spike | Bare Xcode project + `vital-ios` on a real device; verify WHOOP-relayed types land in Junction with usable attribution/timestamps | Junction ingest shows relay data end-to-end |
| 2. MVP build | Scope above, on-device against real WHOOP history | Founder device daily-driving |
| 3. TestFlight | Family challenge testers | Org enrollment cleared |
| 4. App Store | Review checklist above, AI-disclosure question resolved | Approved listing |
| 5. Native roadmap | BLE live HR, Live Activities, widgets, watchOS — pulled by challenge needs, not pushed | Per-feature product case |

## Open Questions

- ~~Does Junction preserve WHOOP source attribution?~~ Resolved 2026-06-10:
  third-party-app data is tagged `source.type: unknown`; `app_id` on summary
  resources only. Scoring must be source-agnostic; see the MVP spec.
- ~~SDK backfill depth?~~ Resolved 2026-06-10: Junction HealthKit ingestion
  defaults to 30 days, configurable to 365 max. Spike measures actual depth.
- `vital-ios` core is AGPLv3 — written commercial-license confirmation from
  Junction is a pre-TestFlight gate (MVP spec).
- Apple AI data-sharing disclosure (above).
- Bundle identifier: `ai.withmurph.app` proposed.

## Repo Placement

New top-level `apps/ios` (Xcode project, Swift), outside the pnpm/TypeScript
workspace graph. No workspace package may depend on it; it consumes the web
API as an external client. CI for it is deferred until phase 2.
