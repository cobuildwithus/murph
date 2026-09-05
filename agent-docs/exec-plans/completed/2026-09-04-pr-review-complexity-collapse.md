# Restore Complexity Collapse in the focused PR review

Status: completed
Created: 2026-09-04
Updated: 2026-09-04

## Goal and scope

Keep two independent PR finding categories: realistically reachable serious
bugs, and material behavior-preserving Complexity Collapse. Restore its
existing narrow remediation exception. Preserve exclusion of speculative bugs,
minor refactoring, UX polish, disclosure findings, and size/round escalation.

## Tasks

1. Align the main/follow-up prompts, registration, and durable workflow owners.
2. Preserve the category label in protocol tests and read back both finding bars.
3. Run focused review-tool tests, CLI typecheck, docs and syntax checks.
4. Archive this follow-up plan, commit, update PR #2832, and verify its new head.

## Verification

Ten focused review-tool checks passed, including category/protocol contracts,
full/delta packaging, routing, and capture checks. CLI typecheck, docs drift,
doc gardening (zero issues), shell syntax, and complexity checks passed.
Parent readback confirms the two independent bars, original collapse exception,
and retained exclusion of speculative/minor findings. The final prompt readback
also passed the focused runner contract again. This is internal review policy;
member runtime, provider inputs, and deployment boundaries are unchanged.
Final ReviewGPT remains exempt under the docs/process and low-risk tooling route.
Completed: 2026-09-04
