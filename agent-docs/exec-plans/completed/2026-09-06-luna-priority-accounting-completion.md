# Complete Luna priority usage accounting

Status: completed

## Outcome

Complete PR #2442, then verify its merged change reaches the protected production release. Close-out preserves immutable historic usage and derives new first-turn pricing only from the provider-returned service tier.

## Scope and decisions

- Reconcile the stale branch with main, preserving Astra accounting and current formal-onboarding scenarios.
- Keep the existing usage record, pricing calculator, ledger and settlement owners. Add no provider requests, database queries or new state owner.
- Verify current official Fast mode rates and returned-tier semantics. Standard fallback remains standard; priority and fast use the existing two-times token adjustment.
- Remove the unrelated semantic-evaluator expansion after inspecting the prior review: its phrase checks overstated semantic proof. Preserve current-main evaluation unchanged and verify accounting deterministically without paid provider calls.
- No member-facing prompt, route, reply or timing changes; no historical repricing or database migration.

## Proof and completion

1. Inspect source, replay, member/provider authority and pricing fallback; resolve conflicts.
2. Run focused shared contract, Web first-turn, allowance, recorder and local PostgreSQL tests; typecheck affected owners; inspect complexity and diff.
3. Close this plan, commit and push; launch exact-head final ReviewGPT concurrently with CI.
4. Resolve required review and CI, merge, and verify managed production deployment and release admission.

## Progress

- Current main requests priority first-turn processing while recording standard pricing.
- Official pricing confirms Luna Fast mode is twice its Standard token rates; both API tier spellings remain supported.
- The three merge conflicts are isolated to tests and verification documentation. The pricing type must preserve Astra's existing supported basis set.

## Implementation proof

- Shared usage contract: 27 tests passed; shared package build and typecheck passed.
- Web first-turn, allowance and recorder proof: 203 tests passed; final first-turn alias matrix: 36 tests passed.
- Isolated PostgreSQL: all four usage integration tests passed, including persisted priority basis, pricing snapshot and period settlement.
- Web typecheck and focused ESLint passed before the final test-only alias expansion; final typecheck is required again.
- Complexity against current main passed for all three production files with no debt or maximum increase. The default comparison during an unfinished merge included unrelated base changes; explicit current-main comparison isolates this PR.
- Raw-payload and documentation-drift guards passed.
- Remaining release gates: commit/push, final ReviewGPT round 3, exact-head CI, merge and production verification.
Updated: 2026-09-06
Completed: 2026-09-06
