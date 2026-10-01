# Recover iPhone sessions and expose bounded auth diagnostics

Status: completed
Created: 2026-09-05
Updated: 2026-09-05

## Outcome and ownership

Returning iPhone members can recover a temporarily unverifiable saved login without logging in again, and operators can diagnose authentication failures using privacy-safe Vercel logs.
Privy owns saved credentials; AppSession owns admission and recovery. The existing companion diagnostics endpoint owns spoofable operational telemetry, never authentication authority.

## Evidence and correction

The adapter maps authenticatedUnverified without a user to signedOut, which triggers destructive local teardown. The root consumes one auth snapshot and foreground recovery only runs for ready sessions. Preserve an explicit unverified state and observe SDK recovery through existing session reconciliation. Do not admit private UI or new health work until identity is verified.

## Diagnostics and compatibility

Extend the existing closed diagnostic envelope with session restore/refresh/backend stages, bounded app/build/OS fields, and a random process-only diagnostic correlation ID. No member identifiers, credentials, raw errors, health fields, disk queues, or additional vendors. Retain a small in-memory failure queue for connectivity recovery; serialize sends and cap/deduplicate events. Keep the existing production enablement and WAF preflight contract. Deploy compatible backend first; old clients remain accepted and old backends may reject new telemetry without affecting login.

## Journeys and verification

- Verified launch, true sign-out, unverified launch, network/SDK recovery, foreground retry, explicit sign-out, cancellation, and member switching.
- No teardown or private admission for unverified launch; confirmed logout still closes local authority.
- Strict legacy/new envelope validation, forbidden-data rejection, bounded transport and offline recovery.
- Focused Swift simulator tests/build and formatting; backend Vitest and typecheck; independent iOS lifecycle/privacy review.
- Production telemetry visibility and real-device recovery require backend deployment and a released iOS build.

## Progress

- Investigation complete; isolated checkouts created.
- Implementation complete across the native companion and existing Web endpoint.
- Web: 112 focused route tests pass; typecheck:prepared passes after preparing the missing public workspace artifact; app-local ESLint, docs drift/gardening, and complexity guard pass. Existing status-query complexity is unchanged and outside the diagnostic route.
- iOS: 331 simulator tests pass across AppSession, PrivyAuthService, AuthDiagnostics, and APIClient; XcodeGen/build and repository SwiftFormat lint pass.
- Independent native lifecycle/privacy review completed; its stop-syncing control and unresolved-logout findings were fixed and verified. Parent checked the complete cross-repository contract and privacy diff.
- The production diagnostics endpoint rejects an empty envelope with 400, confirming the existing enablement gate is open; no production configuration was changed.
- Backend-only changelog decision: internal operational telemetry; the native behavior change belongs to the next iOS release.
- Delivery scope is implementation and scoped commits. Backend deployment and iOS distribution are separate; real-device offline recovery and new-version production events remain release validation gaps.
- Native rendered evidence is captured in the companion repository; scoped commits retain both halves of the compatible change.
Completed: 2026-09-05
