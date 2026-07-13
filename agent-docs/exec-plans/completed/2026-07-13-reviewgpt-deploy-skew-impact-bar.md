# ReviewGPT Deploy-Skew Impact Bar

## Goal

Calibrate the PR ReviewGPT prompt so brief, rollout-bounded unavailability of
one optional or newly introduced feature is treated as residual operational
risk instead of a release-blocking finding when Murph's core reply path and
hard correctness boundaries remain intact.

## Constraints

- Preserve findings for mixed-version failures that affect the core reply path,
  lose or corrupt durable work, cross auth/privacy/security boundaries, cause
  irreversible effects, or strand users beyond the rollout window.
- Reject compatibility machinery whose only benefit is eliminating a short,
  safe, retryable feature outage.
- Keep the prompt outcome-first and avoid product-scale constants that will
  become stale.
- Do not change ReviewGPT tooling, runtime behavior, or historical plans.

## Working Set

- `scripts/chatgpt-review-presets/pr-deep-review.md`
- this plan and its coordination-ledger row

## Verification

- Read back the prompt and inspect the final diff.
- Run the diff-aware repo-internal verification lane for the prompt file.
- Run the required prompt-review completion audit and resolve any actionable
  finding.

## Outcome

- The ReviewGPT prompt now rejects deployment-skew findings whose maximum
  demonstrated impact is a short, safe, retryable outage of one optional or new
  feature while Murph's core reply path remains available.
- It retains findings for core reply degradation, auth/privacy/security
  violations, durable work loss or corruption, irreversible effects, users
  stranded beyond convergence, and broad or repeated impact.
- The first prompt-review pass found one conflict with the prior temporary-gate
  instruction. The wording now applies that instruction only to the converged
  implementation, and the fresh prompt-review rerun found no remaining issues.
- Diff-aware verification passed all repo-internal guards, repo-tools
  typechecking, 308 tests across 19 files, and dependency policy.
- Residual risk: qualitative rollout terms intentionally require model judgment
  until representative paired review cases are evaluated.
Status: completed
Updated: 2026-07-13
Completed: 2026-07-13
