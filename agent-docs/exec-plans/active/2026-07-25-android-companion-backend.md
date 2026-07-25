# Android companion backend and emulator bring-up

Status: active
Created: 2026-07-25
Updated: 2026-07-25

## Goal

- Ship the Murph backend support required by a separate native Android health
  companion, and prove the companion builds, installs, and reaches its real
  launch screen in an Android emulator.

## Success criteria

- The companion sign-in boundary accepts the explicit `android` platform while
  preserving iOS behavior and rejecting every unsupported platform.
- Durable Junction receipt signals retain an unambiguous source provider slug,
  and the companion status endpoint can scope both available resources and
  receipt freshness to `health_connect` without borrowing Apple Health success.
- The additive Prisma migration, focused route/store/webhook tests, repository
  acceptance checks, required review gates, and merge-conflict proof pass.
- The separate `../murph-android` project resolves its real Privy and Junction
  dependencies, passes its tests and static checks, assembles a debug APK, and
  installs and launches on a booted API 36 emulator.
- Emulator proof records the package/activity state and a secret-safe
  screenshot or UI hierarchy showing the real app surface.

## Scope

- In scope:
  - Companion Android admission and diagnostics in `apps/web`.
  - Source-attributed device-sync signals, additive schema migration, webhook
    normalization, and source-scoped companion status.
  - Current durable architecture/security/product documentation for the new
    Android companion boundary.
  - A standalone Kotlin + Jetpack Compose project in `../murph-android`,
    including any smallest vendor-API corrections required for a real build.
  - Local JDK/Android SDK/emulator installation and API 36 emulator proof.
- Out of scope:
  - Production database migration or application deployment.
  - Google Play Console setup, signing, publishing, or store declarations.
  - Claims of real WHOOP/Health Connect data coverage from an emulator.
  - Samsung/Pixel physical-device validation and proprietary WHOOP metrics.

## Constraints

- Technical constraints:
  - Keep the web migration additive and safe for old application bundles.
  - Existing signals with no source slug must not satisfy a source-filtered
    Android status read.
  - Preserve the existing Privy bearer-only companion auth boundary and
    short-lived Junction token handling.
  - Treat the supplied patches as behavioral intent; verify current vendor SDK
    APIs and current `origin/main` before applying or adapting them.
  - Start with only sleep, workouts, steps, and active calories; keep those
    member-controlled permissions separate from backend sync truth and use
    Junction's documented 30-day Health Connect history window.
- Product/process constraints:
  - Preserve the iOS success path and current product-critical device-sync
    flows.
  - Keep health permissions explicit, member-controlled, and fail closed when
    no category is shared.
  - Use the isolated worktree/PR lane, required product-experience and
    specialist review, final ReviewGPT, and same-turn scoped commit workflow.

## Risks and mitigations

1. Risk: Apple Health receipts falsely make Android appear synced.
   Mitigation: persist only unambiguous source attribution and apply the same
   requested source filter to connection resources and receipt timestamps.
2. Risk: Vendor SDK examples or generated project signatures are stale.
   Mitigation: compile against the pinned real artifacts, inspect official
   source/docs/types, and isolate corrections at the auth and health adapters.
3. Risk: Emulator success is mistaken for real Health Connect/WHOOP proof.
   Mitigation: limit the emulator claim to build/install/launch and retain the
   Pixel plus Samsung physical-device gate for actual health ingestion.
4. Risk: The additive database column is deployed before new code.
   Mitigation: keep it nullable and unused by old bundles; deploy the migration
   and compatible web code before distributing the Android client.

## Tasks

1. Verify the bundle checksums, current backend patch applicability, local tool
   availability, and official vendor contracts.
2. Adapt and implement the backend admission, source persistence/filtering,
   migration, focused tests, and durable docs.
3. Extract the standalone Android project, generate its Gradle wrapper, resolve
   real vendor/API build errors, and run tests, lint, and debug assembly.
4. Install the required Android tooling, create/boot an API 36 AVD, install the
   debug APK, launch the real activity, and capture runtime proof.
5. Run the required product/review/verification/PR gates, close the plan through
   `scripts/finish-task`, and hand off deployment and physical-device concerns.

## Decisions

- The Android app remains a separate repository rather than a new monorepo
  workspace.
- Emulator bring-up proves the native shell and dependency integration, not
  real wearable ingestion.
- Source-scoped status is required before the Android client can honestly show
  backend-confirmed Health Connect sync.

## Verification

- Commands to run:
  - `git apply --check <backend-patch>` before adaptation.
  - Focused hosted-web Vitest suites for companion auth/status, device-sync
    signal storage, and Junction webhook source attribution.
  - `pnpm verify:acceptance`.
  - Android `./gradlew test lint assembleDebug`.
  - `adb install -r`, activity launch, `dumpsys`, and secret-safe screenshot/UI
    hierarchy inspection on an API 36 emulator.
- Expected outcomes:
  - All repository and Android checks pass.
  - The emulator reports the Murph Android activity resumed and the first
    member-facing screen is visible without a crash.
