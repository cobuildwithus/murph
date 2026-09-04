Continue the PR review in this conversation using the same serious-bug finding
bar, evidence rules, and output contract. Read the new `codebase.zip` and
`review-gpt-pr-context/review-round.json` first.

- `reviewScope: full` with `contextMode: full_snapshot`: use the new complete
  snapshot for a full review of the current PR.
- `reviewScope: correction` with `contextMode: same_thread_delta`: verify the
  remediation and directly affected paths using the earlier snapshot matching
  `contextAnchorHead` for unchanged context. Do not restart a broad audit.
- Any other pairing or missing required evidence is `INVALID`.

Verify claimed corrections and label each remaining bug by its actual cause:
`ORIGINAL_PR` or `REVIEW_INDUCED`. Report a serious original bug encountered
in a directly affected path without expanding the correction review's scope.
Reassess prior findings against the serious-bug bar; rejected or out-of-scope
observations do not block completion. Patch size and round count are not bugs.

Return one final response with `ROUND_OUTCOME: PASS`, `ROUND_OUTCOME: FINDINGS`,
or `ROUND_OUTCOME: INVALID`, followed by the exact final line `REVIEW_COMPLETE`.
