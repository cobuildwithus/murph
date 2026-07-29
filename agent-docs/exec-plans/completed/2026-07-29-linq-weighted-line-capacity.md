# Weighted Linq line capacity

Status: completed
Created: 2026-07-29
Updated: 2026-07-29

## Goal

- Make Linq line placement account for both direct members and group threads
  using a simple derived planning load, without reducing the provider's
  7,000-message daily allowance or blocking inbound conversation traffic.

## Success criteria

- Line planning load is derived as `10 * direct members + 25 * group threads`.
- New assignments prefer healthy lines below the 5,000-message planning target
  and fall back to the least-loaded otherwise-eligible line.
- The 5,000 target remains advisory; inbound groups and replies remain allowed,
  and line traffic remains allowed up to the 7,000-message provider guideline.
- Group-to-line attribution is queryable from the canonical thread route
  without mutable counters, scheduled reconciliation, or owner-route inference.
- Existing rows have a bounded additive rollout/backfill path.
- Focused tests, required ReviewGPT stages, exact-head CI, and PR completion
  gates pass.

## Scope

- In scope: hosted Web Linq line policy, route projection and migration,
  bounded backfill/readiness tooling, focused tests, and matching durable docs.
- Out of scope: provider-wide traffic throttling, new queues or cron jobs,
  group activity prediction, billing/usage limits, and frontend UI.

## Constraints

- Technical constraints: derive load from existing source-of-truth rows; keep
  the schema rollout additive and backward-compatible; preserve route authority
  and privacy boundaries; keep proactive daily pacing separate.
- Product/process constraints: 10 messages per direct member, 25 per group,
  5,000 soft placement target, 7,000 actual daily allowance.

## Risks and mitigations

1. Risk: legacy route rows lack the new line projection and undercount groups.
   Mitigation: add the nullable projection first, populate all writers
   atomically, surface incomplete coverage, and provide a bounded one-shot
   backfill before relying on the projection operationally.
2. Risk: placement policy accidentally becomes a hard traffic cap.
   Mitigation: keep the selector advisory with least-loaded fallback and add
   regression tests that preserve inbound/current-conversation behavior.
3. Risk: group ownership changes move capacity to the wrong line.
   Mitigation: project the canonical encrypted delivery route's account identity
   rather than deriving it from a member or group owner.

## Tasks

1. Ask ReviewGPT to implement the exact scoped architecture and return a patch.
2. Inspect and apply the patch as untrusted implementation intent.
3. Simplify or correct the implementation against current owners and rollout
   invariants.
4. Run focused proof and the required preliminary specialist review.
5. Complete parent review, commit/push, open the PR, run final ReviewGPT and CI.

## Decisions

- Planning weights are fixed constants: 10 per direct member and 25 per group.
- 5,000 is a placement preference; 7,000 remains the line's actual allowance.
- No mutable aggregate counters, new state owner, or reconciliation loop.

## Verification

- Commands to run: focused hosted Web tests and typecheck, schema/migration
  guards, truthful diff coverage, and the repository's required PR/CI gates.
- Expected outcomes: weighted selection and fallback tests pass, route
  projection/backfill is additive and idempotent, and exact-head ReviewGPT/CI
  complete with no accepted findings.
Completed: 2026-07-29
