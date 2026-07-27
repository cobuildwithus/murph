# PR 966 Late Base Integration

Status: active
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

## Verification

- Commands to run:
  - focused tests selected from the actual overlap
  - canonical verification if manual code resolution changes the candidate
- Expected outcomes:
  - no private-media, deletion, authorization, or Linq regression
