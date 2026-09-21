# Close retained device wake and empty history convergence gaps

Status: active
Created: 2026-09-21
Updated: 2026-09-21

## Goal and scope

Reduce redundant device maintenance by recognizing dirty work admitted by retained reconciliation owners and converging untouched empty weight-history roots with encoded empty unresolved-record evidence. Investigate remaining cadence starts using read-only aggregate diagnostics. No cadence weakening or new queue. After review and required CI, merge and deploy through the existing protected release owner; no ad hoc production data changes.

## Protected invariants

Preserve full-pull freshness, checkpoint publication, source/lifecycle isolation, accepted windows, unresolved evidence, foreground yield, and future retry timing. Reuse the scheduler and queue admission owners.

## Product UX (Patch)

Outcome: less redundant background device work with complete recovery coverage.
Reaches: Junction webhook and retained-owner paths; empty historical weight retries.
Proof: composed mailbox-to-maintenance admission and cold-restored job convergence; negative cases preserve incomplete, malformed, running, and other-source work.

## Tasks

1. Reproduce retained-owner cadence and encoded-empty history failures with synthetic tests.
2. Correct existing admission gates and update owner documentation.
3. Run focused tests, typechecks, complexity guard, and parent diff/privacy review.
4. Open PR, obtain valid ReviewGPT PASS and required exact-head CI.
5. Merge, deploy through the protected workflow, verify the serving version, and report measured remaining wake causes and limits.

## Verification

- Baseline regressions confirmed: the retained-owner cadence scenario and encoded-empty root convergence both fail against the unchanged production files.
- Fixed proof: 16 weight-history queue tests and 227 hosted device-sync / hint-coverage tests pass.
- Both affected package typechecks pass.
- `pnpm complexity:diff` passes: maintenance debt unchanged; job-store maximum complexity decreases from 19 to 18. Existing maintenance hotspots (75, 46, 31) are unchanged lifecycle/logging owners; this correction adds no lifecycle branch or logging behavior.
- Parent candidate review preserves account/lifecycle boundaries, accepted history-window union, foreground yield and malformed/nonempty evidence exclusion. No schema, protocol, dependency or new state owner.
- Product UX: Ready for the bounded internal scheduling correction. Existing coverage and freshness remain; actual container savings require post-deployment observation.
- Changelog: not applicable; internal background compute scheduling and retry consolidation with unchanged member-facing data, controls and freshness contract.
- Final ReviewGPT, exact-head CI, merge and protected deployment remain pending in the PR lane.

## Compatibility and ownership

The existing account-scoped scheduler owns the early full pull; actual dirty job admission qualifies a retained reconciliation wake. The existing SQLite admission owner recognizes only absent or valid version-one empty unresolved evidence and preserves all other retry owners. Old and new runtimes read the same job and mailbox payloads. No Web or Temporal wire contract changes or migration is required; mixed runtimes may retain redundant work until the candidate serves them. No production cadence proof is fabricated from partial webhook work.

