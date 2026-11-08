# Named group acknowledgments without reply latency

Status: completed

## Outcome and invariants

An accepted iMessage group message naming Murph may receive the existing
best-effort acknowledgment. Unnamed chatter never schedules classification.
Direct behavior and foreground reply latency stay unchanged.

## Evidence and design

The thread-route planner appends even when usage is exhausted; Temporal signaling
is not model admission. Keep that durable-input behavior. Before classifying a
named group message, read the existing runtime access/usage owner after response,
in a database-only transaction bounded to 1 second plus 250 ms pool acquisition.
Deny or error means no acknowledgment. This is an advisory availability check,
not a reservation or a guarantee of a final reply; runtime admission stays with
its current owner. Do not add state, polling, telemetry-based authority, or a
runner protocol. The existing per-chat burst owner handles concurrency.

## Product UX

- Outcome: show that Murph noticed an actionable named group request.
- Entry: accepted iMessage group input with a whole-word, case-insensitive Murph
  mention; the unchanged classifier still decides whether a reaction is useful.
- Journeys: named requests, unnamed chatter, name substrings, exhausted groups,
  heavy news, burst follow-ups, fast answers, and direct-message regressions.
- Groups do not apply the five-minute direct-chat suppression because they lack
  early typing. Existing group typing and progress behavior stays unchanged.
- Proof: scheduler/provider spies, bounded transaction assertions, existing real
  SQL burst proof and group self-reaction/engagement boundaries, typecheck/lint.
- Live classifier evaluation previously failed with HTTP 401 account_deactivated;
  no production credentials will be retrieved to work around it.

## Delivery and review

Web-only, no schema or runner changes. Old Web ignores group acknowledgments;
new Web uses the same stored burst format. Ordinary Web rollout is sufficient.
Review the final external-effect change with ReviewGPT alongside exact-head CI.

## Progress

- Recovered the prior diagnostic patch and verified branch ownership.
- Implemented the synchronous text-name gate and bounded background availability
  read. The unchanged classifier and burst owner handle eligible groups.
- Eight focused suites passed: 560 tests, including real PostgreSQL burst proof,
  group routing/self-echo/engagement boundaries and runtime usage decisions.
- After final availability-policy extraction, all 69 orchestration tests passed;
  Web typecheck, lint, and complexity checks passed (maximum complexity 20).
- An initial test run exposed queued mock responses leaking between test cases;
  resetting mocks fixed the fixture without changing production behavior.
- Product UX: Ready for best-effort acknowledgment. No model completion guarantee
  is introduced. Live group classification remains unverified because local
  provider authentication failed; synthetic eval cases are included.
- No new Frog entry: no repository workaround was required. A root-level lint
  invocation was corrected to the existing app-local executable.
- PR #4727 owns final external review and exact-head CI. No schema migration,
  runner deployment or production state mutation is required.

- Changelog generation and all four archive rendering tests passed; final Web
  typecheck passed with the new fragment.
Updated: 2026-11-06
Completed: 2026-11-06
