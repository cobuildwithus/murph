# Companion presence and device failure feedback

Status: active
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
5. Deploy Web then hosted runtime through existing gates; verify live reachability.

## Verification

Implemented bounded server-receipt timestamps, strict private routes, optional
wire capabilities, group grant/source checks, and native lifecycle cancellation.
Focused backend coverage: 63 Web contact/haptic/group tests, 54 wire-parser tests,
11 assistant tool tests, 34 Cloudflare port tests. Package/Web/Cloudflare
checks pass. Native: 325 distinct simulator checks, XcodeGen and SwiftFormat lint.

Five new real-model journeys passed with the production tool contracts and local
subscription: app unreachable, disconnected band, recent/stale Health contact,
and shared group contact. Reviewed replies are Ready: no duplicate buzz, mutation,
or inference that silence proves closure; private diagnostics remain private.
Complete initial provider input: direct 33,938 -> 34,130 o200k tokens
(156,655 -> 157,655 bytes); group 29,012 -> 29,050 tokens
(131,894 -> 132,100 bytes). Fixed synthetic fixtures and normalized temporary
paths/UUIDs; excluded transport prompt-cache key only. Instructions unchanged.
Complexity guard passes with no increased debt; normalize the existing request
signal once rather than introduce another dispatch abstraction.

Independent native review found no concrete issue. User-requested Opus review,
remaining group consent fixtures, final external review, CI, deployment, and
physical presence verification are pending. Physical effects require the
authorized member journey; synthetic tests never vibrate hardware.
