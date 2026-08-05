Continue the PR review in this conversation. Apply the round-1 review rules and
output contract already given above. Do not start a new full review.

Read the attached `codebase.zip`. It is a small correction packet with:

- `review-round.json`, which identifies the exact heads and round;
- `since-previous-reviewed-head.diff`, the patch to verify;
- `changed-since-previous-reviewed-head.txt`; and
- current versions of files touched by that patch.

Use the round-1 ZIP above for unchanged repository context. Review the new patch
and only its directly affected paths. Verify each claimed correction. Report
only a `REVIEW_INDUCED` finding. If the patch reveals a serious missed issue in
the original PR, return `RETROSPECTIVE_REQUIRED` instead of starting another
full audit.

Return one final response and end with the prior exact outcome and
`REVIEW_COMPLETE` contract.
