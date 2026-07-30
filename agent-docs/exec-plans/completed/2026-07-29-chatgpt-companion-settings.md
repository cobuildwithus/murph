# Ship optional ChatGPT connection from iOS Settings

Status: completed
Created: 2026-07-29
Updated: 2026-07-29

## Goal

- Make ChatGPT subscription access an optional, production-safe connection in
  the existing Murph iOS Settings experience.
- Preserve normal Murph behavior when no ChatGPT connection exists and keep
  long-lived ChatGPT credentials on the originating iPhone only.

## Success criteria

- The Release iOS app presents one optional ChatGPT row in Settings and never
  starts authentication unless the user taps it.
- Connect, refresh, status, expiry, and disconnect behavior are covered by
  focused tests, and the server never receives or persists the refresh token.
- The backend accepts only a bounded, short-lived access seed, encrypts it at
  rest, fences stale server generations, and keeps the configured API-provider
  fallback only when the optional connection is absent or explicitly off.
- The feature remains fail-closed behind the production gate until the external
  OAuth-client approval/release decision is satisfied.
- Required iOS screenshots, scoped verification, ReviewGPT gates, CI, and PR
  evidence are complete on the exact pushed heads.

## Scope

- In scope:
  - Reimplement the proven backend/iOS prototype boundaries against current
    `main`.
  - Simplify the iOS entry point into the existing Settings surface.
  - Harden credential lifetime, server generation fencing, provider mode, and disconnect
    behavior at the phone/server/runner boundaries.
  - Update live product/security/operations specifications and PR evidence.
- Out of scope:
  - A web-based ChatGPT connection flow or restoring the hidden web settings UI.
  - Treating a ChatGPT subscription as OpenAI API credit.
  - Background refresh while iOS is suspended, multi-device token sharing, or
    general-purpose expansion of the companion app.

## Constraints

- Technical constraints:
  - The refresh token is stored only in a non-synchronizing, this-device Keychain
    item; no secret value may enter logs, fixtures, repository files, or server
    storage.
  - The backend receives only a short-lived access seed and must preserve the
    existing hosted provider fallback when it is unavailable.
  - Use existing package/public boundaries and no new dependencies.
- Product/process constraints:
  - ChatGPT remains optional and secondary to the thin Apple Health companion.
  - No production enablement may imply unverified third-party authorization to
    reuse another product's public OAuth client.
  - Use isolated worktrees, exact-head review gates, focused local proof, and
    required PR CI.

## Risks and mitigations

1. Risk: The prototype depends on an OAuth client whose use by Murph has not
   been externally approved.
   Mitigation: keep the server gate fail-closed by default, document the release
   prerequisite, and separate code readiness from production enablement.
2. Risk: A refresh token or renewable credential crosses into server state.
   Mitigation: store only the refresh token in this-device Keychain, send only
   bounded non-refreshable access material, and test/log-redact every boundary.
3. Risk: An expired connection silently falls back to Murph-paid usage.
   Mitigation: resolve the seed at turn preparation time, surface an explicit
   needs-attention state, and use the configured platform provider only when
   the connection is absent or explicitly off.
4. Risk: The old prototype diverged substantially from current auth/runtime
   ownership.
   Mitigation: start from current `main`, compare the credential-isolation work,
   and carry forward only the required feature paths.

## Tasks

1. [x] Audit the old backend/iOS prototypes against current ownership, security
   changes, and the credential-isolation PR.
2. [x] Implement the smallest optional Settings flow plus bounded backend seed path
   on current `main`.
3. [x] Add/update focused unit, integration, release-build, and UI-state proof.
4. [x] Run product-experience and preliminary specialist review, remediate findings,
   and perform the parent final review.
5. [x] Commit and push reviewable heads, open replacement PRs, and record the safe
   deployment sequence and external release blockers. The final exact-head
   ReviewGPT and required CI gates run after this plan is archived so they
   certify the immutable completion commit recorded in each PR.

## Decisions

- Supersede the stale, heavily conflicted prototype PRs with current-main
  branches instead of preserving obsolete merge history.
- The iOS Settings page owns discovery and status; authentication details may be
  presented in a sheet, but no separate developer settings hierarchy is added.
- Murph remains fully functional without a ChatGPT connection.
- Code can become deployable while the production gate stays disabled pending
  approval for the OAuth client/application use.

## Verification

- Commands to run:
  - Focused Vitest suites and typechecks for every changed backend/runtime
    package.
  - `xcodegen generate`, `swiftformat --lint`, focused simulator tests, the full
    required simulator test target, and a Release build for iOS.
  - Required ReviewGPT preliminary/final gates and GitHub Actions on exact PR
    heads.
- Expected outcomes:
  - All scoped checks pass with no secret-bearing output or generated
    identifier leakage.
  - Settings screenshots show the optional disconnected row and connection
    detail sheet using synthetic data; state-machine tests cover transitions.

## Completion evidence

- Backend focused proof passed across Assistant Engine, Assistant Runtime,
  hosted execution, Cloudflare runner, and the authenticated Web seed route.
- The preliminary specialist review found two missing fail-closed coverage
  cases. Added regressions now prove authority-read rejection across the dirty
  checkpoint boundary, secret-safe resolver rejection before provider start,
  and stale-bearer disposal when App Server logout rejects.
- The final specialist-remediation files pass with 269 Assistant Runtime tests
  and 240 Assistant Engine tests; both package typechecks also pass.
- The deletion-only Web design-proof guard now correctly excludes removed,
  no-longer-shipped UI. Its focused suite passes 11 tests and the canonical
  docs-drift check passes.
- iOS proof passes 398 unit tests, 19 UI tests, SwiftFormat lint, a Release
  simulator build, and Release-binary credential-marker checks. Four synthetic
  Settings screenshots are committed in the companion PR.
- Product-experience re-review reported no remaining blockers after improving
  action hierarchy, Dynamic Type behavior, unavailable-state proof, and
  privacy language.
- Production enablement remains default-off pending an OpenAI-approved OAuth
  client and reviewed release decision. Physical-device installation remains a
  local hardware step because the paired phone was not visible to Xcode at
  final verification time.
Completed: 2026-07-29
