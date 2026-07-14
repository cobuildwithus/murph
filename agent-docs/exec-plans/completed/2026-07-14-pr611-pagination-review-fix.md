# PR 611 pagination review fix

Status: completed
Created: 2026-07-14
Updated: 2026-07-14

## Goal

- Make the bounded group-join confirmation drain visit every eligible membership exactly once across full page boundaries.

## Success criteria

- Continuation uses the unprocessed lookahead membership inclusively.
- Stateful tests cover 26- and 52-record boundaries plus deferred work.
- Focused tests, typecheck, required audits, CI, and ReviewGPT pass on the pushed PR head.

## Scope

- In scope: group-join confirmation drain pagination and focused tests.
- Out of scope: unrelated hosted runtime behavior and other pull requests.

## Constraints

- Preserve bounded work, deterministic ordering, opaque string cursors, idempotency, and server-side rendering.
- Do not add persisted rollout state or a compatibility layer.

## Risks and mitigations

1. Risk: an inclusive deferred cursor can cause repeated work.
   Mitigation: use an unprocessed lookahead cursor and prove forward progress with stateful tests.

## Tasks

1. Correct cursor selection and query inclusion.
2. Add stateful boundary and deferred-row regression coverage.
3. Verify, audit, commit, push guarded, and rerun ReviewGPT with CI.

## Decisions

- Accepted ReviewGPT round 5's high-severity pagination finding.

## Verification

- Focused hosted group-join tests and rollout tests.
- Web TypeScript typecheck and routed diff verification.
- Exact-head CI and ReviewGPT.
Completed: 2026-07-14
