# Finish concurrent device import query serialization

## Outcome and evidence

PR #3090 enables device imports during model turns. Final coverage exposed
experiment tests that reset modules while retaining an old core instance,
splitting canonical lock ownership. Direct spies remove that setup; all six
experiment outcome tests pass with unchanged assertions.

A separate deterministic regression proves a production cycle: a reader starts
rebuilding while another operation holds the canonical lock; the owner then
queries and joins the reader's pending promise. Both wait for each other.
The regression fails before remediation within a bounded one-second assertion.

## Smallest correction

Delete the pending-rebuild map. Acquire the existing reentrant canonical lock
before checking whether a stale projection still needs rebuilding. Recheck
freshness inside that boundary so queued readers reuse the published projection.
Keep fresh reads, cross-process snapshot publication, and foreground scheduling
unchanged. No new state owner, lock, configuration, or dependency.

## Verification and completion

- Run the new owner/reader regression, existing commit/rollback proof, concurrent
  rebuild coalescing, timing spans, and experiment outcome tests.
- Run query and vault-usecases tests/typechecks and the composed runtime journey.
- Update the live query contract and PR evidence, then push and run ReviewGPT
  round three on the full sensitive snapshot concurrently with final-head CI.
- Complete the plan after focused proof and review; exact-head CI remains a
  completion gate. No merge, deployment, or production mutation is authorized.

## Focused verification complete

- All 1,213 query and vault-usecases tests pass across 116 files, including the
  three canonical writer/query cases and six experiment outcome cases.
- Both affected package typechecks pass. The three composed runtime chat cases
  pass again with the corrected query owner.
- Complexity guard passes; existing file debt remains down seven. The query
  correction deletes eight net source lines and 126 net experiment fixture lines.
- Live query README documents lock reentry, freshness recheck, and timing spans.
  Final ReviewGPT round three and exact-head CI remain pending at candidate push.

## Final review and disposition

ReviewGPT round three passed on e06e6491a94273083ffe58aaf91a51d251d277a7.
The captured model is verified gpt-6-pro; response hash:
`f600ebe084d44f49940de3904a149074c590f87257763b668b8e5c117d0c1894`.
The reviewer confirmed the earlier foreground-routing correction and the query
coordination deletion, with no serious bug or material Complexity Collapse
finding. No accepted finding remains. All 33 CI checks passed on that code
commit; two inapplicable jobs skipped. The final documentation-only head still
requires its own CI; the PR remains the authority for that completion gate.

The parent inspected the final diff, privacy, preserved assertions, lock owner
and freshness paths, and current-base mergeability. A separate alternating
five-run stale-query sample measured medians of 44/45 ms before/after this
correction with 20,000 synthetic readings compacted into 71 entities. This
includes the new freshness recheck and does not establish production p95.

Implementation and review are complete. This closure changes only evidence.
No merge, deployment, or production mutation was performed.
Status: completed
Updated: 2026-09-09
Completed: 2026-09-09
