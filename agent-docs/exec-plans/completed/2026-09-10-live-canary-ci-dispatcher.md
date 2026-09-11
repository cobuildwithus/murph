# Correct live canary GitHub dispatcher CI ownership

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Goal

- Restore the exact-head release gate while preserving live canary behavior and provider-request policy.

## Success criteria

- The provider boundary guard, dispatcher/workflow tests, typecheck, and docs/complexity checks pass; publish the scoped correction for parent-owned review and CI.

## Scope

- In scope: GitHub-only dispatcher naming, references, fixed-origin test evidence, and public-safe friction record.
- Out of scope: provider guard policy, dispatch protocol, live provider operations, environments, merge, or deploy.

## Constraints

- Technical constraints: dispatcher source remains byte-identical across its rename.
- Product/process constraints: coordinate head mutation with the parent review owner and preserve the closed original plan.

## Risks and mitigations

1. Risk: stale references could break the renamed entrypoint.
   Mitigation: workflow contract tests, exact-origin behavioral transport checks, and current owner-doc references.

## Tasks

1. Trace the exact-head failure to provider-name fallback for an unresolved URL template.
2. Rename the GitHub-only dispatcher and update current references without widening guard exceptions.
3. Verify, record the narrow tooling friction, commit, and return the corrected head to the parent.

## Decisions

- General guard changes are unnecessary for this correction; a transport-owner filename accurately describes this GitHub-only controller.

## Verification

- Passed: `pnpm provider-requests:guard`; eleven Node dispatcher tests; six harness workflow tests; tools typecheck; `pnpm complexity:diff`; diff/privacy checks.
- Docs drift and gardening passed with the follow-up plan and owner index update. Parent owns the new exact-head CI and ReviewGPT gates.
Completed: 2026-09-10
