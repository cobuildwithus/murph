# Remove redundant controller recovery from runtime wake

Status: completed
Created: 2026-10-21
Updated: 2026-10-21

## Goal

Explain why a warm container can encounter controller initialization and remove
avoidable application initialization from the wake path. Open a PR and complete
ReviewGPT and required CI. Deployment is outside this task.

## Cause and evidence limits

Container lifetime and Durable Object controller lifetime are independent.
A controller can be invalidated by the platform while its container remains
running. Pending alarms and container monitoring prevent ordinary idle eviction,
but cannot guarantee residency through platform runtime or host changes.
See the official Durable Object lifecycle and Container API documentation:

- https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/
- https://developers.cloudflare.com/containers/api/durable-object-container/

The application constructor adds a second blocking recovery pass after the SDK
constructor. When a running container has no member lifecycle schedule, that pass
creates an immediate deadline. An unbound standby legitimately has no such
deadline after expiry. Readiness already creates a missing deadline, persisted
member schedules survive replacement, and the SDK owns its alarm and monitoring.
The regression fails before deletion because reconstruction writes a deadline.

Removing this pass does not prevent controller replacement or establish how much
platform routing/activation time will be saved. No measured production speedup
is claimed. Precise infrastructure causes require Cloudflare-side evidence.

## Implementation

Delete the constructor recovery block. Keep existing readiness, binding,
authorization, lifecycle, and SDK ownership. No new RPC shape, state, keepalive,
telemetry, dependency, or retry mechanism. The provisional combined bind/readiness
protocol is removed from the final patch because it does not address this cause.

## Product UX and safety

Effort: Patch. Result: Ready; production timing unmeasured.
Warm reconstruction does not create an immediate cleanup deadline. Readiness
still arms a missing deadline without restarting the warm container. Existing
member deadlines survive reconstruction and expire at the original receipt time.
Stopped-container recovery, immutable member binding, active-job protection,
failed-health retries, and native schedule persistence retain their existing proof.
Individual and group provider inputs are unchanged.

## Verification

- New regression failed before deletion and passed after it.
- Passed 503 focused tests across runner lifecycle, standby allocation, fresh and
  retained orchestration, and runner identity.
- Passed 20 tests against the installed Containers SDK, including native schedule
  persistence, deadline execution despite generic RPC traffic, and callback retry.
- Passed Cloudflare typecheck.
- Passed complexity guard: constructor simplified; the three existing hotspots
  (wake, readiness, error classification) are unchanged and outside this deletion.
- Passed changelog generation and all 10 archive rendering tests.
- Parent reviewed the full patch, retained lifecycle owners, rolling versions,
  privacy, and evidence limits.
- PR #4279: ReviewGPT round 1 passed on
  `1d56a34578a9666879c84ba7fa1703623e311e73`, with no qualifying findings.
  The final plan closeout changes only explanatory documentation, preserving the
  reviewed runtime patch under the review loop exemption. Exact-head CI is the
  final external handoff gate and is recorded on the PR.
- Parent final review confirmed no accepted findings, no production mutation,
  no new runtime machinery, and no assertion that platform latency is eliminated.

## Production verification after a separately authorized deployment

Compare bounded bind caller/receiver timing on controller replacement, verify
warm containers are not restarted, and inspect lifecycle cleanup/error aggregates.
Do not interpret removal of application work as elimination of platform latency.
Completed: 2026-10-21
