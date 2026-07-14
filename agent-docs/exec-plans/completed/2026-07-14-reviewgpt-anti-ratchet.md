# ReviewGPT anti-ratchet controls

Status: completed
Created: 2026-07-14
Updated: 2026-07-14

## Goal

- Prevent repeated PR-review remediation from expanding a focused change into a large, multi-owner architecture without an explicit requirement-level reassessment.

## Success criteria

- The PR deep-review prompt makes radical simplicity the primary constraint on findings and corrections.
- Round one reviews the full PR; later rounds receive and prioritize the remediation delta and prior-round context instead of novelty-mining unchanged code.
- Authored source churn at 2,000 lines, stronger 3,000-line growth, repeated mechanism findings, or repeated remediation heads triggers a retrospective rather than an assumed structural verdict.
- The retrospective compares the first reviewed head with the current head and permits deletion, reversion, shrinking, splitting, redesign, or explicitly justified continuation.
- Review tooling distinguishes substantive rounds from retries and packages enough evidence to classify original, review-induced, and pre-existing findings.
- Focused workflow/tooling verification and the required local prompt-review pass complete before the scoped commit lands on `main`.

## Scope

- In scope: `scripts/chatgpt-review-presets/pr-deep-review.md`, the PR review loop documentation, the guarded PR context packager, and focused tests for the packaged round metadata/diffs and prompt/workflow contract.
- Out of scope: product runtime behavior, ReviewGPT browser automation internals, model selection, application code, or running ReviewGPT for this prompt-primary change.

## Constraints

- Preserve the exact first-reviewed baseline; later retrospectives must not reset it.
- Treat source size as an anomaly signal, not a quality verdict or automatic merge rejection.
- Keep a true Complexity Collapse actionable only when it removes source or architectural concepts without replacement machinery.
- Do not weaken the Critical/High bar for concrete, PR-causal, production-faithful failures.
- Keep generated artifacts, tests, docs, config, and authored source classified separately.

## Tasks

1. Add round-aware guarded artifacts to the PR context package with narrow environment inputs and safe defaults.
2. Rewrite the deep-review prompt around simplicity, PR causality, remediation-delta scope, anomaly retrospectives, and explicit round outcomes.
3. Update the loop to create and preserve round metadata, narrow later reviews, exempt non-behavioral proof-only changes, and replace structural-stop language with retrospective decisions.
4. Add or update focused workflow/tooling tests.
5. Run scoped verification, the required local prompt-review audit, reconcile any accepted findings, then commit and push `main`.

## Verification

- `git diff --check` passed.
- Shell syntax passed for the changed ReviewGPT packaging/config verification scripts.
- `pnpm test:diff ...` passed shell/Node syntax, hosted guards, log-payload guard,
  repo-tools typecheck, dependency policy, workspace boundaries/cycles, 309
  repo-tools tests, and the affected CLI typecheck. Its long all-CLI test phase
  was stopped after prompt-review changes made the in-flight source stale.
- Focused ReviewGPT prompt/packager coverage passed: 2 tests, 34 skipped.
- The required local `prompt-review` found three contract gaps: ineffective
  remediation could pass, the first-head baseline was not persisted strongly
  enough, and evidence gaps lacked a parseable outcome. All three were corrected
  with prior-finding verification, a PR-body baseline plus cumulative delta, and
  `ROUND_OUTCOME: INVALID`.
- ReviewGPT was not run because this is prompt-primary work and the user opted out.
Completed: 2026-07-14
