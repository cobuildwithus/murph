# Preserve member drain checks while rolling the dedicated smoke application

Status: completed
Created: 2026-09-08
Updated: 2026-09-08

## Goal

- Unblock compatible Worker releases while preserving serving member capacity and namespace safety.

## Success criteria

- Dedicated smoke proceeds through native admission and readiness without member drain admission.
- Both member runner banks still stop before mutation when drain evidence is unavailable.
- Complete the local correction and focused verification; track final review, exact-head CI, merge and protected deployment in the PR/session handoff.

## Scope

- In scope: deployment-loop smoke classification, regression tests and deployment owner documentation.
- Out of scope: member drain implementation, serving images/capacities, quota changes and runtime behavior.

## Constraints

- Keep the existing class identity as the discriminator; add no state or dependency.
- Retain native readiness, signed smoke and exact release receipts before reporting convergence.

## Risks and mitigations

1. Accidentally allowing member namespace reuse without drain proof.
   Mitigation: exclude only the exact dedicated smoke class and test both member banks with rejected drain evidence.

## Tasks

1. Reproduce the smoke failure through the real deployment loop with an unavailable drain provider.
2. Restrict drain admission to member applications; retain smoke native rollout and readiness checks.
3. Complete local verification and parent review, then hand the stable candidate to PR review and CI before the protected deployment retry.

## Decisions

- Native rollout owns replacement of the isolated smoke application; member drain admission protects member invocations and is not required for smoke replacement.
- Keep the broader member drain provider unchanged and fail closed; its API availability is a separate full-image deployment concern.

## Verification

- Both smoke regressions failed before correction; both member-bank protection regressions passed.
- All 89 CLI/provider/staging/receipt tests pass after correction. Cloudflare typecheck, complexity guard and diff whitespace checks pass.
- Parent review confirms only the dedicated smoke class bypasses member drain; native readiness and signed smoke remain required.
- Local implementation phase is complete. Final ReviewGPT, exact-head CI, merge and protected production convergence remain pending in the owning PR/session.
Completed: 2026-09-08
