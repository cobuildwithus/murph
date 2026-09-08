# Diagnose Garmin canary browser attachment

## Outcome and invariant

Identify whether the repeated remote CDP attachment timeout also affects
Kernel's server-side browser transport. Keep the dedicated protected canary,
credential isolation, authorization assertions, and exact-session cleanup intact.
This diagnostic does not claim to fix the browser timeout.

## Evidence and owner

The latest protected canary connects its WebSocket but times out before browser
attachment completes. The browser runner, Kernel client, and workflow match the
last successful revision. Existing logs cannot distinguish browser failure from
client-to-provider CDP attachment failure.

## Implementation

Use the existing Kernel client only after failed CDP attachment to execute a
constant-return probe. Publish only a fixed responsive/unavailable outcome;
never publish provider result values, errors, capabilities, or page content.
Rethrow the original failure and retain the existing owned cleanup path.
No new state, dependency, production behavior, or deployment contract is needed.

## Verification and next step

Focused browser-runner tests cover successful, malformed, and rejected probe
responses, original failure preservation, and cleanup. Run Web typecheck and
complexity guard, parent review, then exact-head PR CI. After merging, inspect
the protected canary's diagnostic and use that evidence to select the repair.
Product UX and changelog are not applicable to this internal diagnostic.

Local proof: 49 browser-runner tests passed, Web typecheck passed after building
the device-syncd package prerequisite, and complexity guard passed with unchanged
existing hotspots. Parent review confirmed the fixed-vocabulary diagnostic
preserves the original failure and exact owned cleanup.
Status: completed
Updated: 2026-09-04
Completed: 2026-09-04
