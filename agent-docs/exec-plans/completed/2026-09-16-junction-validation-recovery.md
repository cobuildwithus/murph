# Prove Junction validation rejection and recovery

Status: completed
Created: 2026-09-16
Updated: 2026-09-16

## Goal

- Reproduce blood-oxygen and ECG validation failures with synthetic inputs and prove whether corrected responses recover without losing canonical data.

## Success criteria

- Exercise the real Junction SDK/provider, normalization, canonical-write, and retry boundaries appropriate to each failure.
- Preserve source binding and complete-day validation; change production behavior only for a reproduced defect.
- Run focused tests and affected package typechecks and distinguish local recovery proof from unavailable production recovery proof.

## Scope

- In scope: synthetic failure/recovery tests and read-only operational investigation.
- Out of scope: production retries, deployments, provider payload retention, and speculative validation changes.

## Constraints

- Existing provider, importer, core, and SQLite queue owners remain authoritative. Add no dependencies or persistent state.
- Never copy private production evidence into fixtures or this plan.

## Risks and mitigations

1. Synthetic cases might match an error without proving its live trigger. Report that distinction explicitly.
2. Skipping invalid rows could erase or corrupt existing facts. Prove failure leaves the last valid complete day intact.

## Tasks

1. Trace validators, source identity, SDK response conversion, and durable retry exhaustion.
2. Extend focused tests for empty/mismatched ECG collections and invalid blood-oxygen days followed by corrected responses.
3. Run focused verification, inspect the diff, and commit the scoped proof.

## Decisions

- Synthetic reproduction did not establish a data-handling defect. Existing bounds and exact source checks remain necessary.
- Empty ECG collections and absent or mismatched source identity share a failure reason. Synthetic reproduction proves those possible causes, not which one occurred in any live response.
- Rejected blood-oxygen complete days leave canonical facts unchanged; corrected percentage and fraction representations recover with stable identities.
- Exhausted temporal jobs remain terminal across restart. A subsequent enqueue of the same day creates fresh work with a reset retry budget and preserves active-job deduplication.
- Tests only: no member-visible change or changelog entry; no deployment or mixed-version compatibility change.

## Verification

- Passed 41 focused Vitest cases: 19 ECG provider/client cases, 17 blood-oxygen and complete-day importer cases, and 5 SQLite retry/requeue/history cases.
- `pnpm --filter @murphai/importers typecheck` passed.
- `pnpm --filter @murphai/device-syncd typecheck` passed.
- `pnpm complexity:diff` passed; test-only changes are excluded from source complexity analysis.
- `git diff --check` passed. Parent review confirmed synthetic fixtures, no production-state changes, and no privacy leakage.
- Final ReviewGPT and CI were not run: this is local test-only proof, with no PR or production implementation change.
- Production recovery cannot be inferred from synthetic success or unrelated runtime passes. Live provider response classification remains an evidence gap.
Completed: 2026-09-16
