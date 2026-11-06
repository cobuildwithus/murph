# Provider failure telemetry

Add forward-looking diagnostics for browser and SMS failures whose historical
logs cannot identify the failure mechanism. Keep existing error responses,
authentication, retry behavior, and state ownership unchanged. No historical
evidence can be reconstructed. The user authorized merge and deployment after
this follow-up is verified.

Use the existing browser runtime-log event for elapsed operation duration,
actual Kernel evaluation timeout/duration, safe upstream HTTP status, and
closed failure categories. Extend the bounded Twilio diagnostic reader with
closed response-read and parameter-recognition states in the existing safe
server-only error cause. Retain no provider body, URL, script, contact, or
credential. No new storage, network call, retry, or logging destination.

Proof: synthetic provider failures through existing adapter/logging boundaries,
privacy assertions, public-response stability, focused tests and Web typecheck;
parent review, next final ReviewGPT round, exact-head CI. Merge the existing
owned PR, follow the repository production deployment path, then verify deployed
commit and bounded natural-traffic logs.

Verification: 263 tests across the five auth/computer suites pass, including
real Kernel-adapter through runtime-log parser privacy cases from current main.
Web typecheck, changed-file lint, complexity and diff checks pass. Parent review
preserves the newer strict diagnostic-header classification from main (#3948);
this follow-up adds timing, bounded status, explicit unknown categories, and
SMS diagnostic-read/recognition states. The base integration preserves both
implementations and resolves the runtime-log source/test overlap. This adds no
member-facing feature or additional changelog entry. Final review, CI and the
authorized managed production rollout follow on the committed candidate.
Status: completed
Updated: 2026-10-01
Completed: 2026-10-01
