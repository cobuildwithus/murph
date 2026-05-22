# Browser Vault Sample Invariant Follow-Up

## Goal

Add the narrow follow-up from the sample cutover review:

- prove the hosted browser-vault bridge preserves stored projection metric points even when `readVault()` is sparse
- document the distinction between generic debug sample ledgers and display-grade `metric_sample` entities

## Scope

Primary files:

- `packages/assistant-runtime/test/**`
- `packages/assistant-runtime/src/hosted-runtime/browser-vault-replica.ts` only if a test seam requires it
- `ARCHITECTURE.md`
- query/docs sample boundary wording if needed

Out of scope:

- Garmin epoch raw artifact batching
- `importSamples()` renames or API churn
- new projection scopes or sample-point APIs

## Verification

- Focused assistant-runtime/browser-vault test.
- Package typecheck for touched runtime package.
- Docs readback and repo-required final checks.
Status: completed
Updated: 2026-05-22
Completed: 2026-05-22
