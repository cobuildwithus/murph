Goal (incl. success criteria):
- Restore hosted experiment progress-card generation when the runner uses its packaged Health Commons assets.
- Success means the hosted runner package carries the smallest generated biomarker desired-direction projection needed by progress cards, an unavailable auxiliary projection degrades to an explicit warning plus neutral sentiment instead of suppressing the card, and focused tests prove both the packaged success path and missing-asset recovery.

Constraints/Assumptions:
- Preserve progress-card generation as a product-critical user flow; biomarker sentiment metadata is auxiliary and must not block the card.
- Keep the full generated Health Commons web tree out of the hosted runner bundle.
- Reuse the existing Health Commons generator/runtime boundary and the query builder's empty-direction behavior; add no state owner, queue, dependency, or compatibility service.
- Keep malformed packaged data fail-closed. Limit recovery to the expected missing-file condition and surface a warning.
- The older active runner-bundle dependency-prune plan has no open PR and describes work already present on current main; there is no active coordination ledger, so current main is the ownership source for this fix.

Key decisions:
- Generate a compact biomarker desired-direction artifact owned by `packages/health-commons`.
- Add that compact artifact to the runner-specific Health Commons package allowlist and deploy validation instead of restoring `generated/web/**`.
- Make progress-card composition recover only from a missing compact artifact by passing an empty direction snapshot and appending a warning.
- Add direct packed-package coverage that resolves a known desired direction from the extracted runner artifact and direct use-case coverage for missing-asset neutral recovery.

State:
- Candidate ready for exact-head PR review.

Done:
- Reproduced the incompatible current contracts: hosted packaging omits and rejects `generated/web/**`, while progress-card composition reads `generated/web/browse/biomarkers.json` through the pinned package root.
- Confirmed the query builder already renders with neutral sentiment when no direction snapshot is provided.
- Confirmed the focused runtime and package contract tests pass while proving the incompatible behavior.
- Created an isolated task worktree from current `origin/main`.
- Added the compact generated biomarker desired-direction projection, package-root runtime loader, hosted-runner allowlist entry, and deploy-time schema/hash validation.
- Added missing-file recovery that preserves the progress card with neutral sentiment and an explicit warning while malformed artifacts still fail closed.
- Proved the packaged success path by extracting the runner tarball and resolving a known direction from the compact artifact.
- Passed the focused Health Commons runtime and verification suites, the full affected vault-usecase test file, the full affected Cloudflare packaging and deploy-validation test files, and all three touched-owner typechecks.

Now:
- Commit and push the exact review candidate, open the PR, and launch the required preliminary specialist and final ReviewGPT gates concurrently with CI.

Next:
- Resolve any accepted review findings, complete parent final review and merge-conflict proof, then archive this plan with the final scoped commit.

Open questions (UNCONFIRMED if needed):
- None blocking implementation.

Working set (files/ids/commands):
- `packages/health-commons/src/build.ts`
- `packages/health-commons/src/runtime.ts`
- `packages/health-commons/test/runtime.test.ts`
- `packages/vault-usecases/src/usecases/experiment-journal-vault.ts`
- `packages/vault-usecases/test/**`
- `apps/cloudflare/scripts/runner-bundle/workspace-artifacts.ts`
- `apps/cloudflare/scripts/deploy-artifacts.ts`
- `apps/cloudflare/test/runner-bundle-workspace-artifacts.test.ts`
- `apps/cloudflare/test/deploy-artifacts.test.ts`
- `agent-docs/product-specs/health-commons.md`
- Focused package and Cloudflare Vitest commands selected from `agent-docs/operations/verification-and-runtime.md`
