# coverage-lane-speedup

Status: completed
Created: 2026-04-09
Updated: 2026-04-09

## Goal

- Make the repo `pnpm test:coverage` lane materially faster by removing redundant test execution and adding safe parallelism in the package-coverage phase.

## Success criteria

- The root coverage lane no longer reruns the full root multi-project Vitest suite immediately before package-by-package coverage.
- The package coverage phase can execute multiple package coverage commands concurrently without making the lane flaky by default.
- The repo verification docs still describe the actual behavior of `pnpm test:coverage`.
- Required checks pass after the change, including the repo coverage lane itself.

## Scope

- In scope:
  - Update `scripts/workspace-verify.sh` coverage orchestration.
  - Update verification docs if the durable acceptance-lane behavior changes.
  - Run focused verification plus the required repo checks.
- Out of scope:
  - Reworking individual package Vitest configs beyond what is needed for safe orchestration.
  - Broad changes to non-coverage verification lanes unless directly required by the coverage fix.

## Constraints

- Technical constraints:
  - Preserve unrelated worktree edits and existing active ledger lanes.
  - Keep the change in repo-internal verification tooling unless the docs need a durable behavior correction.
  - Keep app verification gated behind package coverage so shared prepared-runtime resources do not contend with the heavier app lane.
- Product/process constraints:
  - The user explicitly asked for both removing the apparent rerun and improving parallelism.
  - Full required verification plus the final audit pass remain the completion bar.

## Risks and mitigations

1. Risk: Parallel package coverage could increase flakiness or overload shared machine resources.
   Mitigation: Use full local fanout for developer speed, but keep CI at half fanout to reduce oversubscription risk.
2. Risk: The removed root no-coverage pass may have been masking a behavior not covered by package coverage.
   Mitigation: Keep package smoke prerequisites and run the full repo coverage acceptance lane after the change.
3. Risk: Verification docs could drift from the new behavior.
   Mitigation: Update the durable verification doc in the same change if the lane contract changes materially.

## Tasks

1. Register the task in the coordination ledger and open this execution plan.
2. Patch the coverage orchestration to remove the redundant root no-coverage run.
3. Add package coverage fanout that defaults to full local parallelism and reduced CI parallelism.
4. Update the verification doc if needed.
5. Run focused verification, then `pnpm typecheck` and `pnpm test:coverage`.
6. Finish with a scoped commit after the required verification passes.

## Decisions

- Keep the root `test` and `test:packages` behavior unchanged; limit the performance work to the coverage lane the user asked about.
- Prefer full local package-coverage fanout by default, with CI cut to half fanout, instead of adding another override knob.

## Verification

- Commands to run:
  - Focused coverage/tooling commands while iterating
  - `pnpm typecheck`
  - `pnpm test:coverage`
- Expected outcomes:
  - Required commands exit successfully.
  - Coverage output shows package coverage still runs, without a preceding redundant full root no-coverage Vitest rerun inside the coverage lane.
Completed: 2026-04-09
