# Companion presence and device failure feedback

Status: completed
Created: 2026-10-01
Updated: 2026-10-01

## Outcome and protected invariants

Expose recent authenticated app contact independently of Bluetooth
readiness and confirmed Health data receipt. The assistant gives the appropriate
recovery step without claiming that stale presence proves app closure, that a
heartbeat proves sync success, or that a queued buzz was delivered.

## Owners and evidence

Public Murph owns the timestamp, authenticated API, wearable command admission,
and assistant tool contract. The native companion owns the lifecycle-bound heartbeat task.
Cloud deployment only consumes the public revision. Edit backend first, native
second, then deploy Web before the runtime and install the compatible app.
Current wearable leases exist only with ready Bluetooth connections, so their
absence cannot distinguish an unreachable app from a disconnected band. Existing
sync diagnostic logs already own detailed Apple Health attempt metadata.

## Smallest design

- Store two nullable server receipt timestamps (last contact and last foreground) on HostedMember; no event history,
  device identifiers, health values, new dependency, queue, or background promise.
- Authenticated companion sends a bounded best-effort heartbeat every
  15 seconds while iOS permits execution; freshness expires after 45 seconds.
  Background requests update last contact only. Stop at member/consent fences;
  suspension naturally prevents execution and never proves the app was quit.
- Add a read-only companion_status device action. Compose it with existing
  list_accounts sync evidence; retain the existing sync diagnostics owner.
- Wearable unavailable responses distinguish app_unreachable, device_disconnected,
  and busy. Persist the command failure reason for stable deduplicated replay.
- Negotiate new response fields through a host-owned optional request flag so
  old strict consumers continue receiving the legacy response shape.

## Product UX

Feature effort. Cover fresh app/disconnected band, stale app, never-seen legacy
app, busy band, successful command, and Health sync failure despite recent app
presence. No new user prompt, permission, or unsolicited message. Existing group wearable
  sharing includes last contact only for an active Apple Health source; exact
  grant/member/consent checks apply and group-email composition omits it. Status is
advisory and has a freshness window, never definitive process-state evidence.

## Failure and rollout

Heartbeat failure never blocks sync, app launch, or commands. Authentication and
consent still gate writes and reads. Additive database migration and Web readers
ship before new native/runtime callers. Existing callers omit the capability flag
and receive no new haptic fields. No queued effect is replayed after reconnect.

## Tasks and proof

1. Implement bounded heartbeat persistence, authenticated routes, and typed tool
   status with auth/replay/skew regressions.
2. Wire native foreground task and lifecycle cancellation; compile and test.
3. Verify assistant failure explanations with focused synthetic real-model tests.
4. Parent review, typechecks, complexity/input measurement, final ReviewGPT and CI.
5. Prepare the ordered Web/runtime/native rollout and its production verification checklist; execute it after merge.

## Verification

Focused Web presence, wrist admission, shared privacy, join-policy and group-tool
coverage passes, including a newer background heartbeat retiring an older wrist
lease. Wire parser, runtime reader, Cloudflare port and assistant tool suites
pass. Web, Cloudflare, engine and runtime typechecks pass. Complexity guard
passes with no increased debt across 24 changed source files. Browser proof
passes at 390px and 1280px with the real group join permission component.

Nine new production-tool real-model journeys cover app unreachable, band
unavailable, recent/stale Health contact, shared group contact, WHOOP/Garmin
wrist offers, unknown ownership and a declined offer. Offers preserve exactly
one requested reminder and produce no wrist command, including when the saved
reminder fires. WHOOP ownership and prior decline are also tested from saved
context. The model never infers sync success or app closure from contact alone.

Complete initial provider input: direct 33,938 -> 34,287 o200k tokens
(156,655 -> 158,458 bytes); group 29,012 -> 29,017 tokens
(131,894 -> 131,896 bytes). Identical synthetic fixtures, normalized temporary
paths/UUIDs, transport prompt-cache key excluded. Instructions unchanged.

Native counterpart: 326 full-suite simulator tests plus one API heartbeat test,
light/dark rendered proof, XcodeGen, SwiftFormat lint and signed iPhone build.
No automated physical buzz or Stop. Independent native review completed.

## Opus review dispositions

Claude Opus 5.5 reviewed the backend/native patch and the corrections. Accepted:
use the existing member/consent error handler for heartbeat failures; avoid
initial active-scene duplicate work and duplicate background reports; disclose
app contact on the Web sharing page; restrict contact metadata to model-facing
group reads; use an explicit wearable-kind allowlist; retire stale foreground
leases after a newer background report; clarify read-only tool failure hints.
Follow-up confirmed those corrections and exposed a test fixture expectation,
which was corrected. Prior-context ownership/decline proof was strengthened.

Do not add a new consent date gate: the requested outcome explicitly includes
existing authorized Apple Health metric sharing. Do not collapse the optional
contact transaction into the required health read: metadata failure should not
block health data, and current authority is revalidated. Do not add cross-phone
lease takeover for the existing bounded re-registration delay. Garmin may sound
and is never advertised as silent. Tiny cross-server clock skew can briefly
classify contact as stale; contact remains advisory.

## Final review and CI follow-up

Round 1 final external review passed on d8793896c7e45e6b372d5801bc14dd2c7f9a8f49:
zero qualifying serious bugs or material complexity-collapse findings. The Eragon
lane selected 6Pro, confirmed the guarded snapshot, and captured the exact
completed turn after 627 seconds. The initial Apollo browser startup failed
before submission; that attempt did not count as a round. The accepted review
covered all 52 changed postimages and the cross-owner authority/data flow.

CI exposed only stale test expectations and a fixture type annotation: new
package export, two scalar timestamps and migration inventory, model-facing
contact opt-in, and the empty member tuple. Corrections preserve production
behavior. Focused tests and affected package/Web typechecks pass; final-head CI
must pass before merge. Native counterpart #173 is merged and main CI is running.

## Rollout handoff

Implementation and focused proof are complete. The PR completion owner retains
responsibility for exact-head CI, additive Web migration/routes, hosted runtime
deployment, compatible native install and physical presence verification.
The authorized member sends any real message-to-buzz request; synthetic checks
never vibrate hardware. Background execution remains opportunistic.
Completed: 2026-10-01
