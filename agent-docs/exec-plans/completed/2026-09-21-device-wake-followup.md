# Close retained device wake and empty history convergence gaps

Status: completed
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
- Final ReviewGPT: PASS on `07d58221e71e0d1e93917f664edb5201e808c746`, Eragon lane, requested and response model `gpt-6-pro`. Exact prompt/response identities and response SHA match; the completed substantive review inspected all seven files and both changed owner paths, reported no qualifying findings, and passed the enforced 180-second minimum. Review: https://chatgpt.com/c/6ab151b9-0748-83ea-9932-6767565f0432.
- Base reconciliation at `ad8972e57159552cb0805b2d20896338fc8ea0fd` preserved both independent index entries. The production correction is byte-identical to the reviewed head. Runtime/coverage tests, both package typechecks and docs drift passed again.
- Parent final review accepts the review and finds no unresolved issues. Implementation and local verification are complete. PR #3627 owns remaining exact-head CI, authorized merge, protected deployment and production observation; these external outcomes are not claimed by this implementation record.

## Compatibility and ownership

The existing account-scoped scheduler owns the early full pull; actual dirty job admission qualifies a retained reconciliation wake. The existing SQLite admission owner recognizes only absent or valid version-one empty unresolved evidence and preserves all other retry owners. Old and new runtimes read the same job and mailbox payloads. No Web or Temporal wire contract changes or migration is required; mixed runtimes may retain redundant work until the candidate serves them. No production cadence proof is fabricated from partial webhook work.

Completed: 2026-09-21
