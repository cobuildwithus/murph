# Complete PR #750 ReviewGPT round 6

Status: active
Created: 2026-07-18
Updated: 2026-07-18

## Goal

- Reconcile PR #750 with current `main`, prove the resulting exact head through every non-ReviewGPT gate required after the five-round cap, and run one trusted correction-verification round that preserves the immutable review lineage.

## Success criteria

- Manual conflict resolution preserves both current-main behavior and the consented group-to-member disclosure plus autonomous scheduled-origin behavior.
- The stale round-1 reset is removed from PR metadata; the first-reviewed head remains `a4b6ac0670e44624f4d3d28ec2fee24035b11da2` and the immediately previous reviewed head remains `060aadaa3124291162f1a8f97f54efde6d653ada`.
- Required focused and full verification, coverage-write, parent final review, and exact-head PR CI are green before round 6 begins.
- A cap retrospective records the original requirement, first-to-current shape, review-driven growth, repeated mechanisms, post-pass scope expansion, and explicit continuation decision.
- ReviewGPT round 6 runs through an existing managed browser lane. Stop and report immediately if the valid result contains a finding; otherwise require `ROUND_OUTCOME: PASS` with zero accepted findings.

## Scope

- In scope: current-main merge and manual conflict resolution; stale plan cleanup; PR intent/review metadata; cap retrospective; required local audits and verification; exact-head push/CI; trusted ReviewGPT round 6.
- Out of scope: new product behavior, speculative compatibility machinery, a baseline reset, a fresh PR, PR merge, or fixing a newly reported ReviewGPT finding without a follow-up instruction.

## Decisions

- Continue the existing PR only under the hard-cap exception explicitly authorized by the user.
- Treat manual conflict resolution and the post-pass autonomous-asks commit as substantive round-6 scope.
- Preserve the existing Postgres/mailbox/outbox/automation owners and derive delivery from trusted origin; do not add another queue, scheduler, lifecycle, or reconciliation path.
- Use ReviewGPT's managed target lifecycle on an existing configured browser lane; do not create or operate ad hoc browser chats.
- Keep the scheduled completion in the synthetic group runtime's existing group-vault write sandbox. The reviewed answer remains untrusted data, the turn is isolated and exact-skip, and only the group read/ask capability is attached; it has no person-facing delivery, connected-app, network, or grantor-personal-runtime authority. A narrower occurrence-bound coordinator-write capability remains future hardening only if product evidence justifies that new abstraction.

## Tasks

1. Merge current `origin/main`, resolve every conflict from three-way evidence, and add focused regression proof only where a resolution exposes a real coverage gap.
2. Run focused verification for conflict paths, the full acceptance lane, coverage-write, and parent final review; correct only proven pre-review issues.
3. Update the PR description with the immutable lineage, current change shape, cap retrospective, intended behavior, invariants, affected surfaces, and deployment order.
4. Push the exact candidate head and wait for all applicable GitHub Actions and Vercel checks to pass.
5. Run trusted ReviewGPT round 6 with full prior-finding dispositions and stop on the first valid finding.

## Verification

- Conflict-path focused suites passed before the final current-main reconciliation: Assistant Engine 166 tests, Web 150 tests, Hosted Execution 78 tests, Assistant Runtime 445 tests, PostgreSQL retention 1 test, and Cloudflare 136 tests (976 total).
- Fresh owner audits passed: Web disclosure/storage/API cleanup 229 tests; workflow guards 3 tests; hosted-local harness 13 tests; migration/privacy/account-deletion 93 tests.
- The scheduled-completion production-composition gap was fixed by scoping the existing platform group port only onto automation-origin Assistant Ask completion wakes. Its system-mailbox regression passed 25 tests and proves ordinary notification wakes receive no group tool.
- Internal-turn isolation and exact-skip coverage passed with the Assistant Engine planning/notification suites (81 tests). Assistant Engine and Assistant Runtime package typechecks passed.
- The removed intermediate root-origin compatibility branches had no shipped producer or persisted-row evidence. Hosted Execution now requires the canonical nested origin; its focused suite passed 4 tests and package typecheck passed.
- The first exact acceptance attempt exposed one stale Hosted Execution test that still constructed the removed root-origin shape. The test now uses the canonical nested origin; the complete Hosted Execution suite passes 383 tests and package typecheck passes. No production code changed for this correction.
- Documentation now matches one request per exact grant per trusted invocation, origin-derived delivery, and the live-E2E coverage gap. `pnpm docs:drift` and `pnpm docs:gardening` passed.
- Privacy/secret and forbidden-cast scans were clean after the pre-review corrections; rerun on the final staged candidate before commit.
- The resource-bounded full acceptance rerun passed on the final reconciled candidate: `NODE_OPTIONS='--max-old-space-size=8192' MURPH_VERIFY_SHARED_HOST=1 MURPH_PACKAGE_COVERAGE_CONCURRENCY=2 MURPH_PACKAGE_COVERAGE_CLI_ACTIVE_CONCURRENCY=1 MURPH_PACKAGE_COVERAGE_VITEST_MAX_WORKERS=2 MURPH_VITEST_MAX_WORKERS=2 pnpm verify:acceptance`. It covered repository guards, typechecks, documentation checks, every package coverage lane, the Web test/lint/dev-smoke/production-build lane, the Cloudflare Node and Worker suites, and fixture smoke coverage.
- Exact-head PR CI, cap-retrospective PR metadata publication, and ReviewGPT round 6 remain pending on the final reconciled head.
