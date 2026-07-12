# Hosted E2E Speed

Status: completed
Created: 2026-07-10
Updated: 2026-07-10

## Goal

- Reduce hosted GitHub E2E wall time and runner occupancy without weakening the production-path behaviors each scenario proves.

## Success criteria

- Grouped GitHub jobs invoke one hosted-local suite so prepared runner images and smoke proof are reused across their scenarios.
- Routine pull-request and `main` CI use a shorter explicit scheduled-reminder timing profile while the protected deployment gate retains the full timing profile.
- The Junction replay scenario reuses the main hosted-E2E build artifacts instead of rebuilding the runner bundle in a separate workflow.
- Harness selection, workflow wiring, and timing-profile behavior have focused regression coverage.
- Required scoped verification, completion audits, commit, push, PR, and PR review gates pass.

## Scope

- In scope: hosted-local E2E scenario selection/batching, the hosted GitHub E2E workflow, the scheduled-reminder test timing profile, focused tests, and canonical CI docs.
- Out of scope: product runtime behavior, provider semantics, production scheduler timing, and unrelated hosted-runtime test refactors.

## Constraints

- Technical constraints: preserve serial scenario isolation, dedicated/test-control Vitest batching, production deployment-gate timing, artifact redaction, and existing required-check names where possible.
- Product/process constraints: prefer deletion and existing harness primitives; preserve unrelated worktree and coordination-ledger edits.

## Risks and mitigations

1. Risk: grouped scenarios leak state or collide on ports.
   Mitigation: use the harness's existing sequential batching, shared build id, cleanup between batches, and focused selection tests.
2. Risk: shorter PR timer windows stop proving real scheduled wakes.
   Mitigation: keep a positive runway and autonomous send assertions, while leaving the deploy gate on the full timing profile.
3. Risk: moving Junction coverage changes branch-protection context.
   Mitigation: preserve the job display name and add workflow-wiring regression coverage.

## Tasks

1. Capture current Actions job and step timing evidence.
2. Add multi-scenario hosted-local selection and focused tests.
3. Rewire grouped jobs and Junction replay to reuse the shared prepared artifacts.
4. Add the explicit routine-CI scheduled-reminder fast profile and prove both timing modes.
5. Update CI docs, verify, run completion audits, and finish through the PR lane.

## Decisions

- Reuse the existing suite batching and runner-smoke proof instead of adding a cache or new service.
- Let the suite-final cleanup own compatible current-build runner images; per-stack container cleanup remains unchanged.
- Keep the full scheduled-reminder timing profile in the protected deployment workflow.
- Preserve the Junction job display name and its 35-minute timeout while moving it onto the shared-artifact matrix.

## Evidence

- Recent successful scenario jobs had a 5m35s median execution time, while post-build runner queueing had an 8m median and reached 26m54s.
- The scheduled-reminder scenario was the slowest intrinsic leg at about 5 minutes of Vitest time, including two deliberate 60-second clocks.
- Shared artifact download/unpack and log upload were only seconds; rebuilding and scenario lifecycle setup were the meaningful controllable costs.
- The harness now accepts grouped scenario selection, reuses one prepared image and smoke proof across compatible batches, and retains dedicated/test-control isolation boundaries.
- Routine pull-request and `main` jobs use an explicit 30-second reminder lead and 1ms idle checkpoint, while the protected deployment workflow remains on the full 60-second/10-second profile.
- Junction replay now runs in the shared-artifact workflow under the existing check display name; the redundant standalone workflow is deleted.
- The required coverage-write audit added a regression proving suite-owned images survive startup failure for outer cleanup and found no remaining actionable coverage gap.

## Verification

- Hosted-local harness coverage: 21 files passed, 385 tests passed, 1 skipped.
- Cloudflare verification: 94 files passed, 1,706 tests passed.
- Post-rebase focused workflow guards, scheduled-reminder timing assertions, cleanup tests, and affected package typechecks passed.
- `git diff --check` passed after rebasing onto the current `origin/main`.
- Live GitHub Actions on the pushed PR head remains the direct proof for runner queueing and the fast scheduled-reminder scenario.
Completed: 2026-07-10
