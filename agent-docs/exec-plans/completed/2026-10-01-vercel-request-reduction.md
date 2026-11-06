# Reduce unnecessary hosted Web requests

Status: completed
Created: 2026-10-01
Updated: 2026-10-01

## Outcome and invariants

Reduce unnecessary HTTP work at existing owners. Preserve runtime authority,
consent, billing recovery, message delivery, and late telemetry staging.

## Evidence and owners

The invite hook schedules unbounded three-second reads, including hidden tabs.
Resource creation/mutation already checks the same owner inside its transaction.
Snapshot start and media mutations can omit their standalone owner preflight.
Opus 5.5 provides an independent read-only investigation.

## Scope and approach

Pause hidden invite polling; back off visible waiting after the initial fast
window and refresh on return. Remove redundant snapshot/media preflights and
unused crypto resolution for media registration/deletion. No new durable state, dependencies, queues, or authority caches.

## Product UX

Outcome: onboarding stays responsive while abandoned tabs stop generating work.
Reaches: visible waiting, hidden tabs, returning tabs, slow/error responses,
changed invites, disabled hooks, and completed onboarding.
Proof: rendered hook with deterministic timers and visibility events; retain
request deduplication and prove cleanup. No visual presentation changes.

## Failure and deployment

Keep the separate minute referral cron: its existing bounded fanout can reach
150 candidates, and its timeout isolation protects billing reconciliation.
Runtime changes preserve deployed reader compatibility and existing authorization
transactions. Private-media capability publication retains its standalone fence
because a reuse path can return a capability without any new resource write.

## Verification

- Web focused suite: 5 invite hook tests passed. Rendered hook tests cover
  visibility return, hidden
  waiting, slow fetch overlap, cleanup, and backoff request counts.
- Cloudflare focused suite: 348 tests passed across runner outbound, runtime
  resource client, and media upload. Snapshot start uses one resource command
  with no owner preflight; media registration/deletion use one Web request and
  no crypto lookup; stale ownership prevents bytes and preserves rejection.
- Web and Cloudflare typechecks passed.
- Complexity diff and whitespace/privacy checks passed. Existing unrelated
  monolithic hotspots remain unchanged.
- No production deployment or before/after production traffic proof in this task.
- Changelog: not applicable; internal HTTP reduction without new presentation,
  product capability, or a member-facing performance promise.
- Product UX: Ready for the scoped polling change; onboarding still refreshes
  promptly on return and during its initial fast window. After thirty seconds,
  visible waits refresh every thirty seconds instead of every three seconds.
- ReviewGPT PR gate: not invoked; this task has no pushed PR. Opus 5.5 reviewed
  the local candidate; a later PR follows the normal repository gates.

## Progress

- Implemented invite visibility/backoff and snapshot/media request consolidation.
- Focused request-count and stale-owner proof pass.
- Opus 5.5 found no authority boundary regressions. Restored the bounded
  completion diagnostic for typed media rejection and added a regression
  assertion. Suggestions affecting private-media reuse or cron timeout isolation
  were excluded after tracing those paths.
Completed: 2026-10-01
