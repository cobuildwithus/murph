# Classify rejected checkpoint generation transitions

Status: completed
Created: 2026-10-01
Updated: 2026-10-01

## Goal

Prove whether foreground snapshot checkpoints can use stale system-progress generation after a background status checkpoint, then correct the existing owner if reproduced. If the mechanism is not proven, add only the smallest observation required to distinguish generation regressions from invalid advances.

## Success criteria

- Synthetic composed proof identifies the cause before a functional correction.
- The atomic Web version/generation guard and unchanged/equal-or-plus-one contract remain intact.
- Focused regression and adjacent lifecycle proof pass without weakening tests.
- Parent review, scoped commit, exact-head required CI and final ReviewGPT complete.

## Scope

Runtime checkpoint ownership, focused tests, and the current protocol documentation. Production investigation is read-only. Functional changes remain for human merge.

## Constraints and risks

Reuse checkpoint builder and existing serialization; do not add state owners, retries, provider calls or database work. Preserve foreground continuation, background progress, and mixed-version protocol behavior. All evidence in this plan and review packets is synthetic or public source information.

## Tasks

1. ReviewGPT examines the composed path and implements only a proven correction or narrowly justified telemetry.
2. Reproduce on base, verify candidate, review simplicity/privacy/cost and update current owner docs.
3. Close plan, commit, push draft and mark ready after focused proof; run final ReviewGPT concurrently with CI.

## Decisions

- Browser failure telemetry is independent and uses a separate checkout and PR.

## Verification

- ReviewGPT did not obtain a composed functional reproduction; no runtime control-flow change is justified.
- Implemented failure-only observation at the existing store TypeError and publication warning: regressed, skipped increment, or invalid initial generation. No generation values or private checkpoint contents are logged.
- New real route/store tests fail on base for exactly the three missing diagnostic codes; seven valid/conflict cases already pass.
- Candidate: 183 route/store tests pass. Error HTTP status/body/headers, original TypeError, version-conflict outcome, SQL predicate and query counts remain unchanged. Throwing logger and unsafe error-property cases pass.
- Web typecheck, complexity, documentation drift and diff checks pass. Exact-head CI and final ReviewGPT are the remaining PR gates. Complexity debt stays 29, maximum 49 in unchanged checkpointHostedWorkspaceTx; no refactor justified.
- Existing recovery caller omits generation and is unaffected. Runtime publication propagates the same exception and route preserves INVALID_REQUEST.
- Internal telemetry only; Product UX not applicable and no changelog item. No provider input, schema, credentials, retention, access policy or deployment compatibility change.
- Production cause and exact recovery remain unresolved until the added observation is naturally exercised.
Completed: 2026-10-01
