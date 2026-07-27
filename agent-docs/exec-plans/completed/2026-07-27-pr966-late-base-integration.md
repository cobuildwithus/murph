# PR 966 Late Base Integration

Status: completed
Created: 2026-07-27
Updated: 2026-07-27

## Goal

- Integrate the latest hosted privacy/group-authorization and saved-card
  funding changes from `origin/main` into PR 966 without weakening private
  media delivery, account deletion, or Linq ownership.

## Success criteria

- Latest `origin/main` is an ancestor of the PR head.
- Any overlap at account deletion, Linq routing, or shared docs preserves both
  branches' current invariants.
- Focused verification for every manually resolved owner passes.
- The required post-conflict ReviewGPT correction round and exact-head CI pass.

## Scope

- In scope:
  - files reported by the normal `origin/main` merge
  - directly affected private-media, account-deletion, Linq, and test owners
- Out of scope:
  - new product behavior or state owners
  - changes to saved-card funding outside a proven merge overlap

## Constraints

- Use a normal merge and preserve current source ownership.
- Do not weaken deletion cleanup, private attachment delivery, authorization,
  or idempotency to make conflicts disappear.
- Preserve the already-published design proof and completed local acceptance
  evidence unless the latest base changes an affected owner.

## Risks and mitigations

1. Risk: account deletion can race private-media staging after integration.
   Mitigation: retain the single UserRunner serialization boundary and prove
   the affected path directly.
2. Risk: Linq ownership changes bypass private attachment delivery.
   Mitigation: walk the resulting call path and run its focused tests.

## Tasks

1. Merge the latest `origin/main` and inventory overlaps.
2. Resolve any conflicts at the current owner boundary.
3. Run focused and required post-merge verification.
4. Close the plan, push, and complete ReviewGPT/CI.

## Decisions

- Treat this base advance as behavior-bearing because it changes the same
  deletion and Linq trust boundaries as PR 966.
- The only manual conflict was the durable documentation index. Preserve the
  new saved-card ownership description and PR 966's private generated-image
  plus encrypted avatar-staging descriptions together.
- Account-deletion and Linq implementation changes merged automatically; prove
  their combined result directly instead of rewriting either owner.

## Verification

- Focused hosted account-deletion, Linq, privacy-migration, and usage-credit
  tests: passed, 220 tests.
- Canonical `pnpm test:diff apps/web agent-docs/index.md`: passed.
  - all repository guards and workspace boundaries passed
  - merged hosted-web TypeScript check passed
  - 6,930 hosted-web tests passed with expected skips
  - lint passed with zero errors
  - dev smoke and production build passed
- The earlier exact candidate also passed canonical full acceptance before this
  base-only update. Per the completion workflow, the clean base integration
  receives the affected-owner rerun above and exact-head CI rather than a
  duplicate full acceptance run.
Completed: 2026-07-27
