# Murph iOS to Android Companion Parity Audit

- **Audit date:** 2026-08-05
- **Status:** Point-in-time landed-code audit
- **iOS baseline:** [`murph-ios` `origin/main` at `7912b353`](https://github.com/cobuildwithus/murph-ios/commit/7912b353c7c0abff0d3f807fba8194f168767ee7), including 38 merged pull requests through [#51](https://github.com/cobuildwithus/murph-ios/pull/51)
- **Android baseline:** [`murph-android` `origin/main` at `02b4c872`](https://github.com/cobuildwithus/murph-android/commit/02b4c872dfdc8cd6fba72a4baae4930c85fdc337), containing 37 direct-to-main commits and no merged pull-request records
- **Unshipped Android work:** [draft Android PR #1](https://github.com/cobuildwithus/murph-android/pull/1), head `9c997ab1`, is excluded from every shipped claim

## Executive summary

Android has a strong native companion foundation, but it is not yet at feature, correctness, or release-process parity with iOS.

The most important repository-landed gaps are:

1. **New-account admission and canonical first-run onboarding are absent from Android main.** Android users can authenticate with OTP, but a genuinely new member is rejected as having no active account and never receives the server-owned contact-card, persona, voice, tone, and welcome flow. Draft Android PR #1 addresses this, but it is not merged.
2. **Android's consent-revision recovery has a confirmed correctness bug.** It submits only documents reported as missing, while the backend requires the full current document set for the scope. A member with one revised document in a multi-document scope can loop on `CONSENT_DOCUMENT_VERSIONS_STALE`. Draft Android PR #1 contains a fix.
3. **The complete private automatic meal-photo experience is absent.** There is no opt-in, future-only media boundary, on-device classifier, sanitized upload path, uncertain-candidate review, Meals surface, permission recovery, or meal-specific teardown. Android explicitly defers this feature.
4. **Android health coverage is materially narrower.** iOS configures 20 SDK resource entries, background HealthKit delivery, and 365 days of history. Android configures four Health Connect resources, is intentionally foreground-only, and uses a 30-day history window.
5. **Two post-launch contact fixes are missing.** Android rejects locally formatted phone numbers and drops a number entirely when safe contact names conflict; iOS normalizes national numbers and preserves up to four aliases.
6. **Typed account-conflict recovery is absent.** Android turns canonical Privy identity conflicts into a generic server error and retry path instead of directing the member to a different sign-in.
7. **Android has no enforceable hosted CI, exact-head review-response gate, or exact-head visual-proof gate.** It has useful local verification and deterministic screenshot fixtures, but every landed Android commit bypassed a PR/Actions gate.
8. **Google Play release evidence is unfinished.** The repository has no landed Play listing packet, Data Safety and Health Apps declaration artifacts, store screenshots, publishing workflow, or verified release-bundle evidence; required real-device health/contact checks are still documented as pending.

The first, second, and sixth items already have implementation work in the open Android draft. The meal, health-scope, background, and release gaps require explicit Android product/platform decisions rather than mechanical Swift-to-Kotlin ports.

## What this audit means by “shipped”

This report uses **reachable from the remote default branch** as the objective comparison boundary.

- GitHub reports 38 merged iOS PRs. All their landed evidence is reachable from the audited iOS head.
- GitHub reports zero merged Android PRs. Android is not empty: its audited main branch contains 37 direct commits. Those commits, not PR metadata, are the Android shipped-code authority.
- The Android checkout contained an open onboarding branch and untracked local store assets. Neither is reachable from `origin/main`, so neither is credited as shipped.
- This is not a Play Store/App Store install audit, deployment audit, or production telemetry audit. “Landed” proves repository state only.
- The iOS remote advanced during the audit. The inventory was refreshed after [iOS PR #51](https://github.com/cobuildwithus/murph-ios/pull/51) merged at 2026-08-05 20:06:53 UTC.

## Prioritized Android gap register

### A1. Canonical new-account admission and onboarding

- **Priority:** P0
- **Status:** Missing from Android main; implemented only in open draft Android PR #1
- **iOS evidence:** [#46](https://github.com/cobuildwithus/murph-ios/pull/46), [#50](https://github.com/cobuildwithus/murph-ios/pull/50), [#52](https://github.com/cobuildwithus/murph-ios/pull/52)

iOS now uses the neutral OTP path to create or resume the canonical hosted account, sends an advisory timezone, and then renders the server-owned one-time onboarding flow when it is pending. That flow includes the optional Murph contact card, main and supporting personas, voice preview and selection, tone, welcome, save/skip, retry, consent interruption, safe sign-out, and cross-surface first-writer-wins reconciliation.

Android main still describes and implements authentication for an existing Murph member. It probes status before neutral account admission, makes `NoAccount` terminal, sends no timezone, has no initial-onboarding API contract, and has no onboarding UI package. A new Android user can complete OTP but cannot complete canonical Murph account creation or onboarding.

- **Required parity outcome:** one neutral create-or-resume admission path, backend-owned onboarding catalog and completion, no app-owned signup state, and the same cross-platform single-completion behavior. Draft Android PR #1 is the current candidate, but it must be evaluated and merged before this can be marked closed.

### A2. Revised consent documents can trap Android in a stale-document loop

- **Priority:** P0 correctness
- **Status:** Confirmed landed bug; fixed only in draft Android PR #1
- **iOS evidence:** [#42](https://github.com/cobuildwithus/murph-ios/pull/42)
- **Code evidence:** [Android consent model/request construction](https://github.com/cobuildwithus/murph-android/blob/02b4c872dfdc8cd6fba72a4baae4930c85fdc337/app/src/main/java/ai/withmurph/companion/api/HttpCompanionApi.kt), [Android continuation owner](https://github.com/cobuildwithus/murph-android/blob/02b4c872dfdc8cd6fba72a4baae4930c85fdc337/app/src/main/java/ai/withmurph/companion/app/AppSession.kt), [backend full-scope validation](https://github.com/cobuildwithus/murph/blob/52ad1e968122fce7f614ce292ad60783bf6469de/apps/web/src/lib/legal/consent.ts)

Android correctly has native consent recovery, strict document links, sequential scope acceptance, stale-code handling, and exact blocked-action continuations. The remaining bug is narrower but material:

- iOS parses the canonical full document list for each scope and submits every current document/version when accepting that scope.
- Android parses only `launchScopes[].missingDocuments` and submits only that subset.
- The backend rejects a request that omits any current document in the scope.

If a member already accepted a multi-document scope and only one document changes, Android repeatedly submits that one document, the backend repeatedly rejects the omitted current documents, and reload does not change Android's request shape.

- **Required parity outcome:** retain the existing single consent owner, parse the server's full per-scope document set, and submit that complete set. Add a regression where exactly one document changes in a multi-document scope.

### A3. Typed account-conflict recovery

- **Priority:** P1
- **Status:** Missing from Android main; fixed only in draft Android PR #1
- **iOS evidence:** [#49](https://github.com/cobuildwithus/murph-ios/pull/49)

iOS distinguishes `PRIVY_USER_MISMATCH` and `PRIVY_IDENTITY_CONFLICT`, closes member-scoped authority, suppresses a useless same-session retry, and offers a safe route to another sign-in. Android main maps both codes to a generic `Server(409)`. Generic sign-out remains an escape, so this is degraded recovery rather than an absolute dead end, but the primary retry can repeat the same terminal conflict.

- **Required parity outcome:** map only the two canonical identity codes to a typed terminal state, tear down member and Junction authority, and lead with alternate sign-in. Unknown 409s must remain generic.

### M1. Private automatic meal-photo capture and review

- **Priority:** P1 major product gap
- **Status:** Entire feature missing and explicitly deferred on Android
- **iOS evidence:** [#19](https://github.com/cobuildwithus/murph-ios/pull/19), [#22](https://github.com/cobuildwithus/murph-ios/pull/22), [#31](https://github.com/cobuildwithus/murph-ios/pull/31), [#33](https://github.com/cobuildwithus/murph-ios/pull/33), [#35](https://github.com/cobuildwithus/murph-ios/pull/35), [#36](https://github.com/cobuildwithus/murph-ios/pull/36), [#37](https://github.com/cobuildwithus/murph-ios/pull/37), [#41](https://github.com/cobuildwithus/murph-ios/pull/41), [#42](https://github.com/cobuildwithus/murph-ios/pull/42)
- **Android evidence:** [README](https://github.com/cobuildwithus/murph-android/blob/02b4c872dfdc8cd6fba72a4baae4930c85fdc337/README.md), [implementation status](https://github.com/cobuildwithus/murph-android/blob/02b4c872dfdc8cd6fba72a4baae4930c85fdc337/IMPLEMENTATION_STATUS.md)

The canonical iOS feature is the #31 lineage; #19 and #22 are stacked ancestors, not three separate feature landings. Later PRs hardened the same system.

Android lacks every client-side product outcome in this stack:

- explicit opt-in and a future-only photo observation boundary;
- best-effort background and foreground processing opportunities;
- on-device meal classification;
- bounded private review for uncertain candidates and recent sends;
- a Meals destination and truthful capture-state UI;
- fresh bounded JPEG rendering, metadata stripping, and upload size caps;
- a least-privilege upload credential and idempotent upload policy;
- fail-closed permission, history-gap, consent, member-switch, disable, and sign-out handling;
- a zero-photo-permission alternative and state-specific recovery copy;
- device, classifier, sanitizer, replay, and teardown regression coverage.

The shared backend enrollment and ingestion foundations already exist, so this is principally an Android client/product gap. A parity implementation must use Android-native media history, permissions, background scheduling, secure storage, and on-device inference. It must preserve the privacy and teardown outcomes rather than copy PhotoKit, Vision, or the iOS extension mechanism.

### H1. Health-data breadth

- **Priority:** P1
- **Status:** Confirmed scope gap
- **iOS evidence:** [#1](https://github.com/cobuildwithus/murph-ios/pull/1), [iOS resource configuration](https://github.com/cobuildwithus/murph-ios/blob/7912b353c7c0abff0d3f807fba8194f168767ee7/MurphCompanion/HealthSync/JunctionSyncService.swift)
- **Android evidence:** [Android resource configuration](https://github.com/cobuildwithus/murph-android/blob/02b4c872dfdc8cd6fba72a4baae4930c85fdc337/app/src/main/java/ai/withmurph/companion/health/JunctionHealthSyncService.kt), [manifest](https://github.com/cobuildwithus/murph-android/blob/02b4c872dfdc8cd6fba72a4baae4930c85fdc337/app/src/main/AndroidManifest.xml)

iOS configures 20 SDK resource entries spanning sleep, activity, workouts, body/profile, VO2 max, heart rate, HRV, respiratory rate, blood oxygen, blood pressure, glucose, temperature, mindfulness, water, caffeine, heart-rate recovery, ECG, AFib burden, and menstrual-cycle data. Android configures only sleep, workouts, steps, and active calories, with matching manifest permissions.

This is not a request to duplicate 20 enums blindly: HealthKit and Health Connect/Junction resource models are not one-to-one. The parity task is to map the product metrics iOS can currently ingest to supported Android resources, prioritize high-value physiological signals, and explicitly document unsupported/provider-limited categories.

### H2. Unattended health-sync continuity

- **Priority:** P1 product/reliability decision
- **Status:** Confirmed outcome gap; Android intentionally foreground-only
- **iOS evidence:** [#24](https://github.com/cobuildwithus/murph-ios/pull/24), [iOS health service](https://github.com/cobuildwithus/murph-ios/blob/7912b353c7c0abff0d3f807fba8194f168767ee7/MurphCompanion/HealthSync/JunctionSyncService.swift)
- **Android evidence:** [architecture](https://github.com/cobuildwithus/murph-android/blob/02b4c872dfdc8cd6fba72a4baae4930c85fdc337/ARCHITECTURE.md)

iOS enables HealthKit background delivery and registers launch observers. Android deliberately disables SDK app-start sync and removes background Health Connect reads, boot receivers, and exact-alarm components because the landed SDK path could not preserve Murph's durable sign-out authorization invariant before worker execution.

Android does match #24's foreground behavior: app entry, foreground return, and manual sync reconcile all currently configured/granted resources, while the backend receipt remains truth. The gap is unattended continuity, not foreground reconciliation.

- **Required decision:** either keep the foreground-only contract explicit or adopt a background primitive only after it can prove member authorization and durable sign-out fencing before any health read/upload. Do not restore removed vendor components without that proof.

### H3. Historical health depth

- **Priority:** P2
- **Status:** Confirmed 365-day versus 30-day outcome difference; likely provider-constrained
- **Evidence:** the same iOS and Android health-service links under H1/H2

iOS requests the SDK's 365-day backfill ceiling. Android hardcodes 30 days and documents that as the Junction Android Health Connect window. Android members can therefore begin with materially less history for baselines.

- **Required decision:** verify the current Junction/Health Connect limit and whether an approved wider history path exists. If 30 days is a platform ceiling, document this as an accepted cross-platform product limitation rather than inventing a second ingestion owner.

### H4. WHOOP Recovery and Strain supplement

- **Priority:** P2 feasibility investigation
- **Status:** Confirmed absence; Android source availability unknown
- **iOS evidence:** [#3](https://github.com/cobuildwithus/murph-ios/pull/3), [supplemental service](https://github.com/cobuildwithus/murph-ios/blob/7912b353c7c0abff0d3f807fba8194f168767ee7/MurphCompanion/HealthSync/SupplementalHealthMetadataSyncService.swift)

iOS has a closed reader for WHOOP Recovery and Strain values stored as HealthKit metadata that Junction omits. Android has no supplemental reader or upload path. The absence is certain, but a direct port may be impossible because Health Connect may not expose equivalent custom WHOOP metadata.

- **Required decision:** first prove whether the Android data source exposes the same values through a supported API. If it does not, record a provider capability gap; do not broaden Android into a generic health metadata reader.

### H5. Sync-interruption reminder and controls

- **Priority:** P2 platform-tailored product decision
- **Status:** iOS outcome absent; Android intentionally defers notifications beyond the vendor foreground-service notification
- **iOS evidence:** [#26](https://github.com/cobuildwithus/murph-ios/pull/26), [#29](https://github.com/cobuildwithus/murph-ios/pull/29), [#30](https://github.com/cobuildwithus/murph-ios/pull/30)

iOS offers an optional, generic reopen reminder when its lifecycle reports a health-sync interruption, plus member-scoped opt-in and Settings controls. Android has no comparable recovery reminder. Because Android is foreground-only and has different lifecycle/notification contracts, this is a product outcome difference rather than a missing line-for-line port.

### C1. Locally formatted contact numbers are excluded

- **Priority:** P1 data-quality fix
- **Status:** Confirmed gap
- **iOS evidence:** [#43](https://github.com/cobuildwithus/murph-ios/pull/43)
- **Android evidence:** [contact projector](https://github.com/cobuildwithus/murph-android/blob/02b4c872dfdc8cd6fba72a4baae4930c85fdc337/app/src/main/java/ai/withmurph/companion/contacts/AddressBookProjector.kt)

iOS resolves international and ordinary national/local contact values using the device country, then emits validated E.164. Android accepts only ASCII international values that already begin with `+` or `00`. Ordinary locally formatted numbers are silently omitted, reducing Friendly Names coverage.

- **Required parity outcome:** normalize against the device region with a proven phone-number library or existing canonical primitive, validate the resulting E.164 value, and retain the current privacy and size bounds.

### C2. Conflicting safe contact aliases are dropped

- **Priority:** P2 data-quality fix
- **Status:** Confirmed gap
- **iOS evidence:** [#44](https://github.com/cobuildwithus/murph-ios/pull/44)
- **Android evidence:** [contact projector](https://github.com/cobuildwithus/murph-android/blob/02b4c872dfdc8cd6fba72a4baae4930c85fdc337/app/src/main/java/ai/withmurph/companion/contacts/AddressBookProjector.kt)

iOS case-folds, deduplicates, sorts, and preserves up to four safe names for a shared canonical number. Android deletes the number from the projection as soon as a distinct name conflicts. Shared family or business numbers therefore receive no advisory label on Android.

- **Required parity outcome:** deterministically preserve a bounded set of safe aliases without changing the server's unverified-display-hint semantics.

### C3. Friendly Names is less discoverable on Android

- **Priority:** P2 UX parity
- **Status:** Partial
- **iOS evidence:** [#39](https://github.com/cobuildwithus/murph-ios/pull/39)
- **Android evidence:** [README](https://github.com/cobuildwithus/murph-android/blob/02b4c872dfdc8cd6fba72a4baae4930c85fdc337/README.md)

The core private address-book projection is shipped on Android: explicit consent, bounded one-shot reads, server CAS replacement/deletion, permission-loss cleanup, and Settings controls are present. iOS also presents Friendly Names as an optional first-run device-setup step. Android exposes it only as a Settings action, so members are less likely to discover it.

This should remain an optional, truthful offer. It must not become signup prefill, contact backup, invitation delivery, identity proof, or routing authority.

### A4. Pre-login auth diagnostics

- **Priority:** P2 operational
- **Status:** Confirmed current-source gap; not attributable to a merged iOS PR alone
- **Related iOS evidence:** [#20](https://github.com/cobuildwithus/murph-ios/pull/20), [iOS diagnostics boundary](https://github.com/cobuildwithus/murph-ios/blob/7912b353c7c0abff0d3f807fba8194f168767ee7/MurphCompanion/Core/AuthDiagnostics.swift)

iOS uses an allowlisted diagnostic taxonomy and can report bounded pre-login failure metadata without raw provider prose, destinations, or identifiers. Android disables provider logging, which is privacy-safe, but collapses network, provider, rate-limit, configuration, and invalid-code failures into generic local messages and sends no bounded diagnostic event.

Only add this if production login support needs it. The parity boundary is the small redacted taxonomy, never raw SDK messages or user-entered destinations.

### A5. Whole-field phone AutoFill convenience

- **Priority:** P3 UX
- **Status:** Confirmed convenience difference; platform-specific
- **iOS evidence:** [#20](https://github.com/cobuildwithus/murph-ios/pull/20)

iOS recognizes a conservative complete US/Canada phone fill into an empty field and auto-sends once, with destination and operation fences. Android accepts phone/email OTP but requires the member to press Send or the keyboard action after a fill. This is not an authentication correctness bug. Validate current Android Autofill conventions before deciding whether parity is desirable.

## Engineering and release gaps

### R1. No hosted CI or enforceable exact-head PR review gate

- **Priority:** P0 before further release landings
- **iOS evidence:** [#11](https://github.com/cobuildwithus/murph-ios/pull/11), [#12](https://github.com/cobuildwithus/murph-ios/pull/12), [#13](https://github.com/cobuildwithus/murph-ios/pull/13), [#14](https://github.com/cobuildwithus/murph-ios/pull/14), [#15](https://github.com/cobuildwithus/murph-ios/pull/15), [#16](https://github.com/cobuildwithus/murph-ios/pull/16), [#17](https://github.com/cobuildwithus/murph-ios/pull/17)

Android has a useful local `scripts/verify.sh` and local ReviewGPT packaging, but its default branch has no `.github` workflow tree and GitHub reports no Actions runs. Its review verifier does not bind a returned review to the canonical PR URL, exact head, round, and PR-body digest. All 37 landed commits were direct-to-main commits.

- **Required parity outcome:** add a minimal Linux workflow for frozen review-tool verification and Android verification, plus a fail-closed exact-head review-response contract. Prefer shared review tooling over a second bespoke validator. Both repositories currently lack branch protection, so branch protection is not an iOS advantage and is outside this comparison.

### R2. No exact-head Android visual-proof gate or instrumentation UI suite

- **Priority:** P1 release quality
- **iOS evidence:** [#8](https://github.com/cobuildwithus/murph-ios/pull/8), [#40](https://github.com/cobuildwithus/murph-ios/pull/40)

Android already has deterministic debug screenshot fixtures. The missing layer is enforcement: no `androidTest` suite, no connected/instrumentation run, no trusted-base exact-head screenshot checker, and no PR evidence contract. Android's implementation status explicitly defers instrumentation screenshot regression tests.

- **Required parity outcome:** reuse the existing screenshot activity for a small Compose/instrumentation smoke suite and require exact-head visual evidence when visible Compose or asset behavior changes.

### R3. Google Play release and privacy packet is not landed

- **Priority:** P0 before Play submission
- **iOS evidence:** [#1](https://github.com/cobuildwithus/murph-ios/pull/1), [#8](https://github.com/cobuildwithus/murph-ios/pull/8), [#27](https://github.com/cobuildwithus/murph-ios/pull/27), [#38](https://github.com/cobuildwithus/murph-ios/pull/38)

Android can test, lint, and assemble debug and release APKs, but its repository still treats Play work as a future checklist. It has no landed Play listing metadata, screenshots, release notes, Data Safety declaration, Health Apps declaration, Contacts disclosure packet, AAB/publish path, or verifier tying the store declarations to the merged release manifest/bundle. Real-device WHOOP/Health Connect and Contacts gates on Pixel and Samsung devices are also still documented as pending.

Apple-specific manifests and screenshot dimensions should not be copied. Android needs the equivalent Play-owned artifacts and evidence.

### R4. Junction/Vital Android commercial-license gate is undocumented

- **Priority:** P0 if the existing commercial grant does not cover Android; otherwise P2 documentation
- **iOS evidence:** [#1](https://github.com/cobuildwithus/murph-ios/pull/1)
- **Artifact evidence:** [Vital client 5.0.2 POM](https://repo1.maven.org/maven2/io/tryvital/vital-client/5.0.2/vital-client-5.0.2.pom), [Vital Health Connect 5.0.2 POM](https://repo1.maven.org/maven2/io/tryvital/vital-health-connect/5.0.2/vital-health-connect-5.0.2.pom)

The resolved Vital Android artifacts declare AGPLv3, while the Android repository has no durable release gate confirming that the existing Junction commercial mobile-SDK permission covers the Android artifacts/version/distribution and no third-party notice inventory. The iOS repository records the equivalent non-secret release gate.

- **Required outcome:** confirm Android coverage from the existing private agreement, record only the non-secret yes/no release gate, and add the required notice/inventory. Do not commit private contract material.

## Important matches and non-gaps

These iOS improvements already have a substantively equivalent landed Android outcome and should not be reimplemented as duplicate systems:

| Capability | iOS evidence | Android landed outcome |
| --- | --- | --- |
| Phone and email OTP, country selection, resend, six-digit confirmation, task ownership, and successful-code cleanup | #1, #8, #20 | Present in native auth and login owners. Only the optional AutoFill convenience and bounded diagnostics differ. |
| Junction identity and stale-session safety | [#9](https://github.com/cobuildwithus/murph-ios/pull/9), [#10](https://github.com/cobuildwithus/murph-ios/pull/10) | Android uses a platform-appropriate forced stale-session sign-out and fresh token-backed identify, plus extensive member-switch and cancellation fencing. |
| Foreground reconciliation of all configured/granted health resources | [#24](https://github.com/cobuildwithus/murph-ios/pull/24) | App entry, foreground return, and manual sync use the full configured Android resource set; source-scoped backend receipts own success. |
| Base private Friendly Names projection | [#39](https://github.com/cobuildwithus/murph-ios/pull/39) | Explicit Settings consent, bounded one-shot read, server CAS replace/delete, replay safety, permission-loss cleanup, and no contact persistence are landed. C1-C3 are refinements. |
| Native launch-consent recovery | [#41](https://github.com/cobuildwithus/murph-ios/pull/41), [#42](https://github.com/cobuildwithus/murph-ios/pull/42) | Strict same-origin documents, sequential acceptance, stale reload, partial progress, and exact health/contact continuation are landed. A2 is the remaining full-document bug; meal continuation is absent with M1. |
| Stopped health-connection recovery | [#51](https://github.com/cobuildwithus/murph-ios/pull/51) | Android already maps `SDK_SIGN_IN_RECONNECT_REQUIRED`, uses passive `resume`, revokes stale local authorization, resets the SDK, and sends `connect` only after an explicit Health Connect action. |
| Honest sync state | Multiple iOS health PRs | Android scopes status to `health_connect`, rejects receipts before the current setup boundary, and distinguishes not connected, awaiting, synced, delayed, and attention states. |
| Legal, support, deletion, and sign-out surfaces | #1, #8 | Signed-out legal links and signed-in Settings controls are present. |
| Murph visual system and deterministic fixtures | #8, #40 | Typography, color, components, core screens, and debug screenshot scenarios are present. R2 concerns enforcement, not fixture absence. |

## Platform-specific exclusions

The following landed iOS work should not be called a straightforward Android defect:

- [#45](https://github.com/cobuildwithus/murph-ios/pull/45) is an Apple Messages extension. Android has no iMessage extension host; any Android/RCS nutrition-card experience is a separate product design.
- Apple privacy manifests, App Store screenshot dimensions, IPA inspection, App Review correspondence, and Xcode/Swift-specific fixes in #1, #8, #27, and #38 require Android equivalents only at the Play outcome level captured in R3.
- iOS Limited Contacts authorization has no direct Android permission-model equivalent.
- PhotoKit background-upload extensions and Vision classification are iOS mechanisms. M1 records the portable product/privacy outcomes, not those APIs.
- Direct WHOOP BLE/PRV work is not on iOS `origin/main` and is excluded entirely from this landed comparison.

## Complete merged iOS PR disposition

This crosswalk is exhaustive for the 38 PRs GitHub reported merged at the audit cutoff.

| iOS PR | Landed change | Android disposition |
| --- | --- | --- |
| [#1](https://github.com/cobuildwithus/murph-ios/pull/1) | App Store submission foundation | Core settings/legal/privacy UX matched. Health breadth maps to H1; Play release outcome maps to R3; licensing gate maps to R4. |
| [#3](https://github.com/cobuildwithus/murph-ios/pull/3) | WHOOP Recovery and Strain metadata | Absent and platform-constrained; H4. |
| [#8](https://github.com/cobuildwithus/murph-ios/pull/8) | App Review fixes and synthetic UI fixtures | Core permission honesty and fixtures matched. Apple review work is platform-only; enforcement/release gaps are R2/R3. |
| [#9](https://github.com/cobuildwithus/murph-ios/pull/9) | Junction identity reconciliation | Matched by Android's identity, member-switch, cancellation, and teardown hardening. |
| [#10](https://github.com/cobuildwithus/murph-ios/pull/10) | Persisted Junction credential validation | Matched by a different platform policy: Android discards/re-identifies stale SDK authority instead of copying the iOS probe. |
| [#11](https://github.com/cobuildwithus/murph-ios/pull/11) | Guarded PR review workflow | Partial local tooling only; R1. |
| [#12](https://github.com/cobuildwithus/murph-ios/pull/12) | Separate review control paths | No hosted Android analogue; R1. |
| [#13](https://github.com/cobuildwithus/murph-ios/pull/13) | Review scanner false-positive fix | Exact old scanner bug is not reproduced; Android's missing enforceable control plane remains R1. |
| [#14](https://github.com/cobuildwithus/murph-ios/pull/14) | Snapshot-safe review fixtures | Exact fixture surface does not exist; lower proof coverage is covered by R1/R2. |
| [#15](https://github.com/cobuildwithus/murph-ios/pull/15) | Review response identity-link validation | Missing exact-head response validation; R1. |
| [#16](https://github.com/cobuildwithus/murph-ios/pull/16) | Main-only macOS CI | Apple cost/toolchain policy is not portable; Android has no hosted product CI at all, R1. |
| [#17](https://github.com/cobuildwithus/murph-ios/pull/17) | Main-only review-loop docs | Android documents a local loop but has no equivalent exact-head hosted contract; R1. |
| [#19](https://github.com/cobuildwithus/murph-ios/pull/19) | Initial optional background meal capture | Missing, but stacked into the canonical #31 lineage; M1. |
| [#20](https://github.com/cobuildwithus/murph-ios/pull/20) | Phone AutoFill and auth-operation hardening | Core OTP lifecycle matched. Bounded diagnostics are A4; whole-field AutoFill is A5. |
| [#22](https://github.com/cobuildwithus/murph-ios/pull/22) | PhotoKit sign-out correction | Nested in the meal lineage; required teardown invariant if M1 is built, not a separate feature count. |
| [#24](https://github.com/cobuildwithus/murph-ios/pull/24) | Reconcile every active health resource | Foreground/app-return/manual behavior matched for Android's configured resources. Background outcome remains H2. |
| [#26](https://github.com/cobuildwithus/murph-ios/pull/26) | Best-effort sync interruption reminder | Platform-tailored outcome difference; H5. |
| [#27](https://github.com/cobuildwithus/murph-ios/pull/27) | App Store 1.0.2 and Swift SDK fix | Swift/Xcode fix is not portable; analogous release preparedness remains R3. |
| [#29](https://github.com/cobuildwithus/murph-ios/pull/29) | Notification opt-in for connected members | Platform-tailored reminder gap; H5. |
| [#30](https://github.com/cobuildwithus/murph-ios/pull/30) | Notification controls in Settings | Platform-tailored reminder gap; H5. |
| [#31](https://github.com/cobuildwithus/murph-ios/pull/31) | Canonical private meal-capture integration | Entire client feature missing; M1. |
| [#33](https://github.com/cobuildwithus/murph-ios/pull/33) | Meal navigation, review, and reconciliation | Missing with M1. |
| [#35](https://github.com/cobuildwithus/murph-ios/pull/35) | Meal image compression and sanitization | Missing mandatory privacy boundary within M1. |
| [#36](https://github.com/cobuildwithus/murph-ios/pull/36) | Meal privacy, permission, and notification trust UX | Missing with M1; reminder portion also maps to H5. |
| [#37](https://github.com/cobuildwithus/murph-ios/pull/37) | Text-a-photo-first meal consent framing | Missing portable product/copy outcome within M1. |
| [#38](https://github.com/cobuildwithus/murph-ios/pull/38) | App Store 1.1.2 release packet | Apple-specific mechanics; analogous Play gap is R3. |
| [#39](https://github.com/cobuildwithus/murph-ios/pull/39) | Private Friendly Names sharing | Base system matched. Discoverability and later data-quality fixes are C1-C3. |
| [#40](https://github.com/cobuildwithus/murph-ios/pull/40) | Exact-head screenshots for UI changes | Debug fixtures exist; exact-head enforcement and instrumentation are missing, R2. |
| [#41](https://github.com/cobuildwithus/murph-ios/pull/41) | Distinguish meal consent failures | Core structured 403 handling matched. Meal-specific continuation is missing with M1. |
| [#42](https://github.com/cobuildwithus/murph-ios/pull/42) | Native consent recovery | Substantially matched; A2 is a confirmed revised-document bug and meal continuation is absent with M1. |
| [#43](https://github.com/cobuildwithus/murph-ios/pull/43) | Normalize local/national contacts | Missing; C1. |
| [#44](https://github.com/cobuildwithus/murph-ios/pull/44) | Preserve conflicting contact aliases | Missing; C2. |
| [#45](https://github.com/cobuildwithus/murph-ios/pull/45) | Inline nutrition Apple Messages card | Apple-only extension host; excluded from direct Android parity. |
| [#46](https://github.com/cobuildwithus/murph-ios/pull/46) | Shared hosted native signup | Missing on Android main; A1. Draft Android PR #1 only. |
| [#49](https://github.com/cobuildwithus/murph-ios/pull/49) | Typed account-conflict recovery | Missing on Android main; A3. Draft Android PR #1 only. |
| [#50](https://github.com/cobuildwithus/murph-ios/pull/50) | Canonical onboarding API contract | Missing on Android main; A1. Draft Android PR #1 only. |
| [#52](https://github.com/cobuildwithus/murph-ios/pull/52) | Canonical account-onboarding UI | Missing on Android main; A1. Draft Android PR #1 only. |
| [#51](https://github.com/cobuildwithus/murph-ios/pull/51) | Recover stopped hosted health connections | Product recovery already present on Android main; the open draft adds more explicit persisted reconnect truth but is not needed to claim baseline recovery exists. |

## Suggested closure order

1. **Finish the already-started correctness lane:** bring draft Android PR #1 to an exact reviewed head, verify its backend compatibility, and land A1-A3 plus the A2 partial-revision regression.
2. **Ship the small data-quality corrections:** C1 and C2 are bounded projector changes with clear tests and no new state owner. Decide whether C3 belongs in the existing first-run device setup.
3. **Choose Android health policy explicitly:** map H1 resource availability, verify H3 provider limits, and decide whether H2 can be solved without weakening sign-out/member authorization. Record H4 as unsupported if the source data is unavailable.
4. **Make an explicit meal decision:** either keep M1 intentionally out of Android or fund the full privacy/reliability surface. Do not ship a partial uploader without future-only boundaries, sanitization, scoped authority, teardown, and private review.
5. **Close release controls before Play distribution:** R1-R4, the documented Pixel/Samsung health/contact matrix, and a verified Play release packet.
6. **Treat H5, A4, and A5 as evidence-led follow-ups:** they are useful outcomes, but lower priority than account admission, consent correctness, health coverage, contact data quality, and release gates.

## Audit limitations and refresh rule

- This was a static comparison of GitHub merge metadata, default-branch history, current source trees, tests, and repository release docs.
- It did not run either mobile app on a physical device, query private production member data, or verify store availability.
- Existing Android docs record passing JVM/lint/APK verification and an emulator smoke, but still list physical WHOOP/Health Connect and Contacts gates.
- New iOS or Android merges after the exact heads at the top of this file require refreshing the inventory and affected gap rows. Open branches, local files, and non-main WHOOP/PRV experiments must not be credited as shipped.
