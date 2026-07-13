# PR 549 final audit fixes

Status: completed
Created: 2026-07-12
Updated: 2026-07-12

## Goal

- Close the three validated findings from PR 549's final ReviewGPT audit
  without broadening approval state or delivery recovery machinery.

## Success criteria

- Approval reconciliation applies observations only to the exact parked cycle.
- Approved vault-file sends cannot be re-homed after approval.
- The web/runtime deployment and rollback floor is explicit in durable docs.
- Focused and repository-required verification pass on the pushed final head.

## Scope

- In scope: approval observation contracts, runtime reconciliation, Linq target
  authority, focused tests, and deployment documentation.
- Out of scope: unrelated main changes, a second ReviewGPT audit, or new queues,
  persisted state, and recovery managers.

## Constraints

- Technical constraints: preserve the existing approval row and intent owner key
  as the two current sources of truth; fail closed on mismatches.
- Product/process constraints: one final audit only; preserve unrelated work and
  use the PR branch's current task-specific diff.

## Risks and mitigations

1. Risk: a refreshed row may share the stable approval id with an older intent.
   Mitigation: return and compare the opaque cycle owner on every read.
2. Risk: provider recovery may replace the target after approval consumption.
   Mitigation: reject redacted/changed vault targets before consume and disable
   provider home-route fallback for vault media.

## Tasks

1. Validate the audit findings against the exact pushed implementation.
2. Add the narrow contract and authority checks with focused regression tests.
3. Document the compatible web/runtime deploy and rollback floors.
4. Run required verification, finish the plan, push, and prove final-head CI.

## Decisions

- Keep the cycle owner opaque across the web/runtime boundary instead of adding
  another persisted generation field.
- Keep ordinary Linq recovery available only when the caller explicitly grants
  home-route fallback; vault-backed media never grants it.

## Verification

- Commands: affected package typechecks/tests, web typecheck/lint, `pnpm
  test:diff`, root typecheck, docs drift/gardening, and GitHub final-head checks.
- Expected outcomes: all required commands green; no unresolved review threads;
  PR is non-draft and merge-ready.
- Completed locally: focused hosted-execution and assistant-runtime tests,
  focused typechecks for all four changed owners, root `pnpm typecheck`, web
  lint (zero errors), `pnpm test:diff`, docs drift, and doc gardening all pass.
  The standalone database-only approval suite remains intentionally outside the
  standard web matrix and cannot run without a live local Postgres; its ten tests
  all stop at the unchanged `127.0.0.1:1` test-harness connection boundary.
Completed: 2026-07-12
