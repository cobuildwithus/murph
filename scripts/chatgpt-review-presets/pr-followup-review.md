Continue the PR review in this conversation. Apply the review rules and output
contract already given above. Do not start another conversation.

Preserve the required `Complexity disposition:` for every finding, and give
findings caused by one mechanism one shared root-cause correction instead of
stacking another guard.

Read the attached `codebase.zip` and then read `reviewScope` and `contextMode`
from `review-gpt-pr-context/review-round.json` before choosing the round scope.

When `reviewScope` is `full` and `contextMode` is `full_snapshot`:

- treat this ZIP as the new complete guarded snapshot of the current PR;
- perform a fresh full-patch audit of `review-gpt-pr-context/pr.diff` and the
  current repository files, including portions unchanged since the prior round;
- verify every prior accepted finding and claimed correction using the
  conversation's finding ledger and the current ZIP; and
- report qualifying `ORIGINAL_PR` or `REVIEW_INDUCED` findings under the review
  rules already given above.

When `reviewScope` is `correction` and `contextMode` is `same_thread_delta`:

- use the most recent earlier `full_snapshot` ZIP in this conversation for
  unchanged context;
- review `since-previous-reviewed-head.diff` and only its directly affected
  callers, owners, invariants, tests, and production paths;
- verify every claimed correction; and
- report only a `REVIEW_INDUCED` finding. If the correction reveals a serious
  missed `ORIGINAL_PR` issue, return `RETROSPECTIVE_REQUIRED` instead of opening
  a new full audit.

Any other scope/mode pairing is `INVALID`. Return one final response and end
with the prior exact outcome and `REVIEW_COMPLETE` contract.
