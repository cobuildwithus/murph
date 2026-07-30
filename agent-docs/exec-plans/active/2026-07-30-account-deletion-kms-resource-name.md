# Account Deletion KMS Resource Name Repair

## Goal

Restore durable hosted account-deletion cleanup by using the parent Google Cloud
KMS `CryptoKey` for decrypt operations while preserving fail-closed retries and
supporting the existing version-named cleanup receipt without a data migration.

Success criteria:

- New cleanup receipts persist a validated parent `CryptoKey` name.
- Existing receipts that contain a numeric `CryptoKeyVersion` name normalize to
  the parent key in memory before decrypting.
- Malformed or mismatched resource names fail before provider I/O and retain
  retry ownership.
- Focused KMS and account-deletion tests cover the real Google response shape,
  the existing receipt shape, and malformed names.

## Constraints

- Do not manually retry or modify production cleanup state.
- Do not weaken account-deletion, privacy, lease, or retry invariants.
- Do not add a migration, dependency, compatibility service, or provider-state
  mutation.
- Treat the ReviewGPT patch as behavioral intent and inspect every change before
  landing it.
- Keep identifiers, credentials, and private provider data out of repository
  artifacts and logs.

## Plan

1. Apply and inspect the ReviewGPT-authored patch in the isolated task worktree.
2. Validate KMS resource parsing and reduce the patch if existing abstractions
   already own the behavior.
3. Run focused KMS and account-deletion tests plus the required web typecheck.
4. Run the required preliminary and final review gates on exact pushed heads,
   resolve accepted findings, and require green CI.
5. Close the plan, commit the scoped result, and complete the PR workflow.

## Verification

- Focused KMS and account-deletion Vitest suites passed on current `origin/main`
  with 32 tests.
- Hosted web typecheck passed.
- Scoped ESLint passed for the two source files and two focused test files.
- A read-only production-faithful check proved that the pending receipt's
  numeric `CryptoKeyVersion` resource normalizes to its parent `CryptoKey`
  without decrypting the payload or invoking provider cleanup.
- The required local product-experience review returned `NO FINDINGS`; no
  rendered proof applies because this change has no frontend presentation.
- The preliminary ReviewGPT specialist pass returned one accepted low-severity
  coverage finding. Its test-only patch was inspected, path-scoped, applied,
  and verified; encrypt now has direct proof that a version resource is rejected
  before provider I/O.

## State

Implementation and focused verification complete. PR completion gates pending.
Status: active
Updated: 2026-07-30
