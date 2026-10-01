# Conditional native update guidance

## Outcome and invariant

People on an unsupported iPhone app build see an update action before sign-in,
instead of repeating an authentication flow that cannot work. Ordinary releases
remain optional. No credential, local member state, or Health authority is erased.
The shipped app must first contain this screen; earlier binaries cannot acquire
it remotely. There is no Web notice and no Android change.

## Owners and smallest change

One anonymous, database-free endpoint publishes an explicitly configured minimum
iOS build. One in-memory native presentation policy checks it at launch and on
foreground. Existing session/auth/Health owners remain unchanged. The fixed App
Store URL is compiled into the app; the server cannot redirect users elsewhere.
No dependencies, persisted state, rollout dashboard, or version telemetry.

## Failure and rollout

Unset minimum means no required update. Malformed configuration returns 503;
clients retain a known update requirement on failure and otherwise preserve their
normal offline behavior. Requests are anonymous, bounded and redirect-free.
The UI policy is not an authorization boundary or background-work shutdown.
Deploy the disabled endpoint first, ship the reader, then raise the minimum only
for an actual compatibility break once an obtainable replacement is available in
all supported storefronts and OS versions. Do not disable legacy authentication
as part of this change. Clear the setting to withdraw the UI requirement.

## Proof

- Route tests: absent/valid/invalid policy, no-store response.
- Native boundary tests: anonymous fixed request, strict schema/size/status.
- Native state tests: older/equal/newer builds, offline startup, retained and
  withdrawn requirement, concurrent checks.
- Simulator: actual update screen, current login, dynamic type, App Store action
  affordance. Physical App Store update remains a signed-device release check.
- Focused compiler/test checks, exact-head visual evidence, required reviews and CI.

## Status

Implementation in progress. No production minimum has been activated.
