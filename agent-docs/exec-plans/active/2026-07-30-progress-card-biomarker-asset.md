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
- Relay only that exact missing-direction warning through every member-facing progress-card owner; keep unrelated renderer diagnostics private.
- Add direct packed-package coverage that resolves a known desired direction from the extracted runner artifact and direct use-case coverage for missing-asset neutral recovery.

State:
- Accepted first-round findings remediated locally; correction candidate is ready to commit, push, and review.

Done:
- Reproduced the incompatible current contracts: hosted packaging omits and rejects `generated/web/**`, while progress-card composition reads `generated/web/browse/biomarkers.json` through the pinned package root.
- Confirmed the query builder already renders with neutral sentiment when no direction snapshot is provided.
- Confirmed the focused runtime and package contract tests pass while proving the incompatible behavior.
- Created an isolated task worktree from current `origin/main`.
- Added the compact generated biomarker desired-direction projection, package-root runtime loader, hosted-runner allowlist entry, and deploy-time schema/hash validation.
- Added missing-file recovery that preserves the progress card with neutral sentiment and an explicit warning while malformed artifacts still fail closed.
- Proved the packaged success path by extracting the runner tarball and resolving a known direction from the compact artifact.
- Passed the focused Health Commons runtime and verification suites, the full affected vault-usecase test file, the full affected Cloudflare packaging and deploy-validation test files, and all three touched-owner typechecks.
- Preliminary specialist ReviewGPT and final ReviewGPT round 1 independently found that the missing-direction warning stopped at command JSON instead of being guaranteed member-facing. The specialist pass also requested direct catalog-hash mismatch coverage.
- Added the exact branch-specific same-response disclosure to manual active-experiment context, day-four and final lifecycle moments, weekly health digest, and experiment-onboarding guidance. Added owner tests for every route and did not expose other renderer warnings.
- Applied and verified the specialist's narrow catalog-hash mismatch regression test.
- Passed four focused assistant owner suites (97 tests), assistant-engine typecheck, and the affected Cloudflare deploy-artifact suite (42 tests).
- Captured complete first provider-visible requests through the pinned real Codex App Server with a synthetic scheduled weekly direct/group turn and active experiment, `gpt-5.6-terra`, low reasoning, code mode, and `gpt-tokenizer` 3.4.0 `o200k_harmony`: individual 131,789 bytes / 28,470 tokens at base and 132,309 / 28,566 at head; group 118,331 / 25,541 at base and 118,591 / 25,589 at head.

Now:
- Commit and push the combined first-round remediation, update the PR evidence, and launch final ReviewGPT correction round 2 against that exact head.

Next:
- Require green correction-head CI and ReviewGPT, complete parent product-experience and final diff review plus merge-conflict proof, then archive this plan with the final scoped commit.

Open questions (UNCONFIRMED if needed):
- None blocking implementation.

Working set (files/ids/commands):
- `packages/health-commons/src/build.ts`
- `packages/health-commons/src/runtime.ts`
- `packages/health-commons/test/runtime.test.ts`
- `packages/vault-usecases/src/usecases/experiment-journal-vault.ts`
- `packages/vault-usecases/test/**`
- `packages/assistant-engine/src/assistant/active-experiment-context.ts`
- `packages/assistant-engine/src/assistant/experiment-support-automations.ts`
- `packages/assistant-engine/src/assistant/managed-automations.ts`
- `packages/assistant-engine/skills/experiment-onboarding/SKILL.md`
- `packages/assistant-engine/test/**`
- `apps/cloudflare/scripts/runner-bundle/workspace-artifacts.ts`
- `apps/cloudflare/scripts/deploy-artifacts.ts`
- `apps/cloudflare/test/runner-bundle-workspace-artifacts.test.ts`
- `apps/cloudflare/test/deploy-artifacts.test.ts`
- `agent-docs/product-specs/health-commons.md`
- Focused package and Cloudflare Vitest commands selected from `agent-docs/operations/verification-and-runtime.md`
