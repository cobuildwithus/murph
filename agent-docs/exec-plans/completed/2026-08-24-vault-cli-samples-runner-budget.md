# Vault CLI Samples Runner Budget

## Goal

Reproduce and resolve the exact 30-byte production runner-bundle overage at local head `e3082742` without weakening the entry-chunk or static-startup closure budgets.

## Scope

- Run the canonical production runner assembly in the existing task worktree.
- Attribute the total-byte delta to the reviewed CSV recovery candidate or unrelated bundled behavior.
- Prefer a clean source deletion or simplification when it preserves the reviewed recovery contract.
- Otherwise ratchet only the total-byte budget and its exact-boundary test to the measured combined candidate, with a concise baseline comment.
- Do not push, mutate PR metadata, or run ReviewGPT.

## Tasks

1. Reproduce the exact assembly failure and capture total, entry, and static-closure measurements.
2. Compare the candidate with its local parent using equivalent clean bundle assembly.
3. Apply and verify the smallest valid correction.
4. Run focused bundle tests, final assembly, diff/privacy checks, and create one scoped local commit if needed.

## Verification

- Canonical `pnpm --dir apps/cloudflare runner:bundle` assembly.
- Focused runner CLI-bundle Vitest suite.
- `git diff --check` and a secret/identifier diff scan.

## Completion

- Archive this plan with `scripts/finish-task` when a repository change is required.
- Report attribution, exact measurements, local commit, and verification to the parent agent.
Status: completed
Updated: 2026-08-24
Completed: 2026-08-24
