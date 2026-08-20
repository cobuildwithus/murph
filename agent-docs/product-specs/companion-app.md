# Native Companion Apps (Health Sync)

Last verified: 2026-08-15

Current iOS distribution status: approved for the App Store. The canonical
public listing is `https://apps.apple.com/us/app/murph-ai/id6786145859`.
The separate native Android companion is executable-verified on an API 36
emulator but has not passed the required physical-device or Play review gates.

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
through, **including full historical backfill to device purchase**. WHOOP's
recovery and workout-strain scores are not mapped as ordinary Apple Health
types, but the WHOOP app preserves them as `WHOOP Recovery` and `WHOOP
Strain` custom metadata on sleep/workout objects. The companion's bounded
native reader can recover those two fields. Still unavailable: WHOOP HRV and
the detailed five-stage sleep breakdown; sleep exports as in-bed/asleep/awake
fragments without WHOOP's stage detail.

Apple HealthKit's standard HRV quantity is SDNN, so Apple Health observations
remain canonical `hrv-sdnn`. The existing provider resolver selects at most
one daily `hrv-rmssd` point across WHOOP Recovery, Oura, and other provider
evidence. The direct WHOOP 5/MG path below produces a beta overnight
pulse-rate-variability estimate under `whoop-ble-overnight-prv-rmssd`, with no
generic `hrv` or biomarker alias. These series must never aggregate together.

An internal 2026-07-10 hardware spike proved the private WHOOP 5/MG BLE
pulse-interval transport with Heart Rate Broadcast off. The beta calculator
extends that transport into a one-time-enrollment, automatic overnight path.
After the member explicitly connects the band, the app continuously subscribes
and evaluates a fixed `00:00–08:00` local civil-time window without a nightly
Start or Finish action. It freezes the timezone rules for each night, so travel
or a settings change cannot retarget an in-progress or retained occurrence. A
fully traversed occurrence is bounded to 84...108 five-minute windows:
typically 84, 96, or 108, with intermediate counts such as 90 or 102 for
half-hour timezone transitions. It accepts a window only with 240–300 seconds of
pair-supported interval coverage and takes the equal-weight mean of accepted
window RMSSDs. It publishes only when at least 48 windows were accepted and at
least half of completed windows qualified. The nightly
upload has exactly `schema`, `methodVersion`, `nightDate`, `rmssdMs`,
`completedWindowCount`, and `acceptedWindowCount`; the completed count covers
full attempted five-minute windows and the sole accepted method is
`prv-rmssd-5m-mean-scheduled-0000-0800-local-v1`. Raw BLE packets, R-R
intervals, packet timestamps, exact capture times/duration, timezone offset,
coverage milliseconds, WHOOP account identity, any band identifier, and
per-window values are never uploaded or logged. A BLE disconnect hard-breaks interval adjacency and the
current window segment; reconnect may continue the same scheduled night, but no
interval or window crosses the gap and the final coverage gates decide whether
the night qualifies.

The only health-derived local persistence is one schema-versioned,
OS-protected scalar checkpoint for the current scheduled night and an outbox of
at most three already-derived strict envelopes. The checkpoint contains only
the frozen schedule/night identity, next window position, completed/accepted
counts, and accepted-RMSSD sum. The current partial window is discarded after a
process gap; intervals and per-window results remain memory-only. The exact
app-scoped CoreBluetooth peripheral UUID may persist beside the checkpoint only
to restore the enrolled band; it never uploads or enters logs. A single local
watchdog notification is continually postponed while the stream is healthy and
reminds the member to reopen Murph if callbacks stop. Leaving the app
backgrounded or the phone locked is sufficient; force-quitting prevents iOS
from relaunching the BLE app until the member opens Murph again.

Backend admission accepts one strict envelope per active connection and
`nightDate`, retains a sparse hashed replay receipt for 30 days (at most 64 per
connection), and reuses encrypted staging, the existing local retry row, and
canonical-success acknowledgement. Canonical storage independently owns one
immutable summary per vault, `whoop` source, and `nightDate`, using a synthetic
12:00Z `occurredAt` and no event `timeZone`. This does not reproduce WHOOP's
proprietary overnight HRV or Recovery algorithm and is not clinical ECG HRV.
Distribution remains gated on written WHOOP authorization plus legal/privacy
approval, a signed-iPhone overnight capture-to-query test, forbidden-data
network/log proof, and paired-ECG validation.

Local band enrollment and hosted connection lifecycle are separate. The visible
one-time Connect WHOOP action enrolls only the CoreBluetooth band and does not
send hosted `connectionIntent: "connect"`. A known same-member passive SDK
repair sends `connectionIntent: "resume"`. A fresh or unproven installation
omits intent and lets durable server state decide: exactly one established row
resumes, zero provider rows may establish the first lane, and terminal or
ambiguous state rejects without mutation. Only a future visible
hosted-health/Junction Reconnect action may send `connect` and create/reactivate
that lane. Data upload and local outbox retry never establish a lane. Local
band disconnect or sign-out disables BLE resume and clears local enrollment,
checkpoint, peripheral UUID, and outbox state after band cleanup without
silently changing hosted connection state.

Ship the scheduled-method runtime/Cloudflare consumer first with immediate
container rollout, fingerprint proof, and a compact import smoke; ship web
acceptance plus resume/omitted-intent/future-connect authority second;
distribute iOS last. Once iOS
can emit the scheduled method, web and runtime support remain the rollback floor
until those clients and all staged envelopes drain. Roll back in reverse order.

A thin iOS companion app that reads Apple Health and feeds the existing
Junction pipeline removes WHOOP's veto from the critical path, covers every
wearable that writes to Apple Health (Apple Watch included — no OAuth
integration exists for it today), and keeps members on their normal
WHOOP-app-plus-Bluetooth flow.

WHOOP does not document a supported deep link to its Apple Health integration
screen. Product guidance must use the documented in-app path instead: **More →
App Settings → Integrations → Apple Health → Connect**, then enable all desired
categories and tap **Allow**. Do not invent a `whoop://` settings URL. After
that step, members download Murph, sign in, and connect Apple Health in the
Murph app.

## Strategic Posture (Hybrid)

1. **Companion app is the backbone.** Baselines and challenge scoring use
   sleep + RHR (+ workouts), all relay-available. Recovery and workout Strain
   are optional foreground enrichment from two exact metadata keys, never a
   prerequisite for the ordinary Apple Health sync path.
2. **WHOOP API approval is an enrichment, never a dependency.** The Junction
   `whoop_v2` BYOO integration stays; if approval lands it upgrades fidelity
   (HRV, recovery, webhooks, richer sleep stages) for members who connect it.
   The 10-member cap covers current beta scale meanwhile.
3. **Android is a narrow Health Connect bridge.** The separate native Kotlin
   app carries OTP login, explicit health setup, source-scoped backend status,
   settings/legal controls, and optional background sync. It does not expand
   into chat, vault browsing, automatic meal-photo capture, or a general Murph
   client.

## Android Health Connect Companion

The Android app lives in its own native Kotlin + Jetpack Compose repository.
It uses one manual composition root, Privy phone/email OTP, Junction/Vital with
`ConnectionPolicy.Explicit`, and no local health-value store. A visible
**Connect Health Connect** action requests `connectionIntent: "connect"`;
known same-member passive restoration requests `"resume"`. Sign-in alone never
creates a hosted health connection, and sign-out or member switching tears down
the local Junction session before Privy logout.

Every newly authenticated signup must complete this canonical account flow
before status, token exchange, or any health setup:

1. `POST /api/device-sync/companion/admission` with the Privy identity bearer
   and only the optional device-local IANA `timeZone`.
2. The route normalizes a rejected non-empty Privy bearer to `AUTH_REQUIRED`;
   discard that stale authentication state and return to login. Preserve typed
   `PRIVY_USER_MISMATCH` and `PRIVY_IDENTITY_CONFLICT` for the existing safe
   alternate-sign-in recovery. On typed `HOSTED_CONSENT_REQUIRED`, use the
   existing bearer-only legal-consent `GET` and `POST` boundary to render and
   record the required launch grants, then retry admission. On typed
   `HOSTED_ACCESS_REQUIRED`—including a member whose prior billing history
   makes automatic starter enrollment unsafe—enter the existing
   billing/activation access recovery instead of falling through to health
   setup. Typed
   `HOSTED_MEMBER_SUSPENDED` enters suspended-account support recovery.
   `COMPANION_ADMISSION_RETRYABLE` keeps the account gate visible with an
   explicit retry, while `COMPANION_ADMISSION_SUPPORT_REQUIRED` enters support
   without repeating a terminal request.
3. Advance only when the admission response is exactly `{ "ok": true }`.
   Transport failures, malformed success bodies, unrecognized typed errors,
   and failed recovery remain on the account gate.
4. After successful admission, read source-scoped status as sync truth and show
   health setup. Status is not account admission and must never replace step 1.

Admission grants no Junction or device authority. A newly authenticated signup
must not request a sign-in token, sign in to the Junction SDK, or create or
resume a hosted connection before the member explicitly chooses **Connect
Health Connect**. A consented fresh companion activation with a verified phone
may enter the ordinary hosted signup-welcome path. The existing exact-member
binding, signup idempotency, home-line health, and proactive-capacity owners
still govern that path. Exhausted proactive capacity does not block activation:
Web assigns an eligible home line without a proactive welcome, and inbound-first
messaging remains available. If no line is assignable, account activation still
succeeds without assigning one. The exact active member's first provider-
attested direct message can bind the contacted managed line when the existing
reply-egress policy permits it, including at-risk and delivery-warning lines
that cannot initiate outreach. Unmanaged, disabled, ambiguous, or unsafe lines
cannot establish that exact-line authority; ordinary fallback selection still
fails closed when no eligible line exists. A successfully delivered welcome uses the existing finite
unfinished-onboarding continuation: at most one low-pressure opportunity on
each of the next three local days, with the ordinary stop rules. Companion
admission does not also send the signup welcome email. A committed activation
whose runtime wake is not accepted stays on the retryable account gate; retry
re-signals only the exact pending Starter activation mailbox item. Canonical starter-usage activation, active-access
proof, and the internal `member.activated` fact remain intact. Existing
established-member session restoration retains its separate
documented `resume` path and cannot turn admission itself into health
connection authority.

The Android home screen treats
`GET /api/device-sync/companion/status?sourceProviderSlug=health_connect` as
sync truth. The response's server `observedAt` owns setup age, receipt
freshness, and relative-time copy; the phone wall clock never does. When a
refresh is unavailable, Android may retain the cached projection for context
only if it labels the surface **Last checked online** and suppresses the frozen
waiting, synced, delayed, needs-attention, and relative-time claims until one
explicit check succeeds. Webhook receipt rows retain a normalized source slug
only when the provider-owned webhook parser identifies the source of an actual
data-bearing event. Data-less historical completions, lifecycle events, and
legacy rows keep that field null. When a historical completion instead leads
to a successful canonical import, the exact dirty-payload acknowledgement adds
a source- and resource-scoped import receipt after checkpoint. Source-scoped
status filters connected-source availability and both receipt kinds, so
null-source rows never satisfy Android status and failed, zero-record,
source-fenced, or merely accepted pulls never look synced.

The client keeps its Junction resource request centralized and starts with four
minimum-necessary groups: sleep, workouts, steps, and active calories. The
manifest makes only their corresponding Health Connect read permissions
explicit. Any added category must pass Google's minimum-necessary review and
physical-device evidence for the product benefit.
WHOOP's Health Connect export does not provide proprietary Recovery, Strain,
WHOOP Age, or Pace of Aging scores, so Android must not claim iOS metadata
parity or call the iOS-only supplemental metadata endpoints.

The SDK is configured for Junction's documented fixed 30-day Android Health
Connect history window. The additional history permission is permission, not
availability evidence. Background-read access remains separate and is requested
only when the member opts into optional background sync.

Rollout order is additive backend migration and web support first, Android
distribution second. Immediately after migration, Android may show
waiting-for-first-data until a new Health Connect webhook creates source-scoped
receipt evidence. Apple Health receipts must never substitute.

## Architecture Decisions: Native Swift and Kotlin

SwiftUI + Junction `vital-ios` (SPM) + Privy `privy-ios` for auth (same Privy
app and user identities as the web vault).

Android uses Kotlin + Jetpack Compose with Privy's native Android SDK and
Junction's Health Connect SDK. Both apps remain separate native repositories;
behavioral contracts are shared through the web API rather than a cross-platform
runtime.

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
5. **Custom metadata is closed, not generic.** The app may read only the two
   approved WHOOP keys, hash source record identity on-device, validate
   finite ranges, and upload bounded batches. It never uploads whole
   metadata dictionaries, raw HealthKit identifiers, or an arbitrary metric
   name/unit/event schema.
6. **Direct BLE reduces locally.** One explicit enrollment keeps the WHOOP
   subscription active and automatically evaluates the fixed local
   `00:00–08:00` window. Pulse intervals exist only transiently inside the
   current five-minute calculation window. The app persists neither intervals
   nor per-window values and uploads one compact nightly summary only after the
   method's coverage gates pass. Restart safety is limited to one protected
   scalar night checkpoint and three already-derived strict-envelope outbox
   entries, plus the exact app-scoped CoreBluetooth peripheral UUID needed to
   restore the enrolled band. That UUID never uploads or enters logs; the
   backend does not schedule capture.

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
- The native Recovery/Strain reader runs on launch, foreground return, and
  explicit refresh. It has no independent background observer in this slice;
  Junction background delivery remains responsible for ordinary Apple Health
  categories.
- Direct WHOOP BLE capture is different from HealthKit background delivery: it
  depends on the enrolled CoreBluetooth subscription and can continue while
  Murph is backgrounded or the phone is locked, but iOS will not relaunch it
  after a member force-quits the app. The local watchdog reminder is the only
  recovery prompt; there is no nightly Start/Finish UI or backend wake.

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
5. **Narrow metadata enrichment** — Recovery from `.inBed` sleep samples and
   Strain from workouts, sent through the authenticated device-sync route.
6. **Settings** — per-data-type toggles, disconnect, delete-my-data.
7. **"Sync now"** foreground affordance + periodic-sync expectations copy.

Out of scope for the public v1: chat surfaces, vault UI, direct WHOOP BLE,
widgets, Live Activities, watchOS, Android. The overnight PRV capability is an
internal beta and does not expand the App Store surface until its authorization,
privacy, signed-device, and paired-ECG gates pass.

### Automated native acceptance

Auth/control/device-sync changes use the protected cross-repository acceptance
lane documented in `agent-docs/references/testing-ci-map.md`. The required PR
proof runs the normally compiled iOS app on an Apple simulator against the exact
PR SHA deployed as a real hosted/minified Web build, with the dedicated real
non-production Privy test account/OTP, real companion admission/legal consent and
sign-in-token persistence, real Junction sandbox SDK calls, and the real iOS
HealthKit permission UI. Mocked, fixture, hosted-local, or hermetic coverage
cannot replace that gate. Native completion alone is insufficient: before
cleanup, trusted orchestration proves the fixed Privy principal was created in
this run and the corresponding real Junction sandbox user reports a connected
`apple_health_kit` provider. Before native dispatch it also proves the exact
candidate origin succeeds anonymously without deployment-protection credentials.
The protected runner owns `orchestrator_owned_reset`: retire only lane-owned E2E
deployments, enumerate the lane-exclusive Junction sandbox team, delete its sole
production-derived or orphaned lane user and prove the team empty, reset only the
isolated E2E database, then delete only the fixed Privy user. Production canary
mode uses an existing identity and is non-destructive.

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
| 4. App Store | Review checklist above, AI-disclosure question resolved | Approved 2026-07-13; public listing live |
| 5. Native roadmap | Validated direct overnight PRV, BLE live HR, Live Activities, widgets, watchOS — pulled by challenge needs, not pushed | Per-feature product case plus vendor/legal/privacy and physical-validation gates |

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

The native app lives in its own Swift/Xcode repository beside this monorepo.
No workspace package depends on it; it consumes the web API as an external
client and carries its own build/test workflow.
