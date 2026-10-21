# Preserve query errors across archived audit reads

## Cause and correction

CLI release coverage reproduced a regression in the composed timeline path:
audit enumeration now uses core's archive-aware row parser, whose low-level
VAULT_INVALID_JSONL error bypassed QueryVaultSourceError. Translate that precise
audit parser error at the existing query-source boundary, keeping the logical relative
path and line number while dropping parser causes and source content. Event-ledger and other
storage errors continue unchanged; no new fallback or retry behavior.

## Proof

The existing CLI query-source recovery test fails before the correction. Extend
it to plain and Brotli audit files, checking the same terminal error code, stage,
repair hint, content/path privacy and unchanged source bytes. Focused query and
CLI proof, affected typechecks and complexity checks are required before commit.
Final PR review/CI evidence is maintained on PR #3660; the first-reviewed head
remains immutable, and this production correction requires substantive round 2.

## Implementation completion

- Focused composed CLI recovery suite: 4 passed, including plain and Brotli
  source privacy and exact source-byte preservation.
- Query audit/source-manifest suites: 20 passed, including existing event-ledger
  error behavior. Query and CLI typechecks passed; complexity guard passed.
- Parent reviewed the narrow cause and correction. Only the newly rerouted audit
  parser error is translated; no event-ledger error contract changes.
- The independent viewport hover failure passed on an unchanged-head rerun and
  is recorded in the task-owned Frog entry `20260922181638-goal-source-hover`.
- This scoped correction is complete. The required second ReviewGPT round and
  final exact-head CI remain PR completion gates, with results recorded in the
  PR evidence rather than another production or documentation change.
Status: completed
Updated: 2026-09-22
Completed: 2026-09-22
