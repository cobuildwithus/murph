# PR 522 ReviewGPT Round 6

## Goal

Close the validated final-review findings without weakening group-chat privacy:
classify ambiguous inbound Linq chats before mutation, let durable thread routes
avoid unnecessary provider reads, preserve legacy ambiguous-message fail-closed
behavior, and make the coordinated rollout contract operationally executable.

## Constraints

- A durable `HostedThreadRoute` remains the group-container authority.
- Route-less inbound Linq traffic must not reach personal onboarding without
  canonical direct/group truth.
- Persisted `false` and `null` directness remain fail-closed in the runner.
- Do not hold a database transaction open across a Linq network request.
- Prefer the existing route store, canonical chat reader, and planning branches;
  add no new durable state or compatibility manager.
- Preserve metadata-only diagnostics and retry-before-mutation behavior.

## Implementation

1. Resolve Prisma before classification and pre-read an existing Linq thread
   route for ambiguous inbound messages.
2. When a route exists, inject conservative group truth and skip canonical Linq
   lookup; keep the planner's transactional route re-read authoritative.
3. When no route exists, canonicalize every inbound Linq service, including SMS
   and RCS, before planning.
4. Add focused regressions for routed canonical-failure bypass, SMS/RCS direct and
   group classification, and retryable pre-mutation classification failure.
5. Strengthen the PR rollout contract to hold web production until guarded runner
   convergence and the old-container drain window are proven.

## Verification

- Focused hosted-web classification and thread-route tests.
- Focused assistant channel/import/planning tests preserving legacy ambiguity.
- Web and affected package typechecks/lint.
- Required diff-aware/full verification and completion audits.
- Green PR CI and a valid exact-head ReviewGPT round using both a 120-minute
  browser timeout and response timeout.

Status: completed
Updated: 2026-07-10
Completed: 2026-07-10
