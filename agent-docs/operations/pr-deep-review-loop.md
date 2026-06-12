# PR Deep-Review Loop

Last verified: 2026-06-12

Required external deep-review loop that runs after the repo-required completion workflow, on PR-lane work.
It is additive: it never satisfies, replaces, or reorders the required completion audits in `agent-docs/operations/completion-workflow.md`.
For non-trivial PR-lane work, do not call the PR good to merge until this loop has passed.

## When It Runs

Run the loop when all of the following hold:

1. The task used the worktree/PR lane and a PR is open.
2. All routed completion audits passed and the scoped commit is pushed.
3. The user has not explicitly opted out in the current task.

Fire each round as soon as the head it reviews is pushed — do NOT wait for
PR CI to go green first. CI and the review round run in parallel; a round
typically takes as long as the CI lane, so serializing them roughly doubles
loop latency for nothing (the reviewer reads the pushed diff, not CI
output). Green CI on the final head remains a hard MERGE-READINESS gate: a
PR is merge-ready only when the final head has both green CI and a
zero-accepted-findings round.

Skip it only for docs/process-only PRs, trivial copy-only changes, or explicit current-task user opt-out.

## One Round

1. Fire a new ChatGPT thread (never reuse a thread between rounds; omitting `--chat-url` creates a fresh one):

   ```sh
   pnpm review:gpt pr-review \
     --prompt "PR: <pr-url>" \
     --send --wait --wait-timeout 60m \
     --response-marker REVIEW_COMPLETE \
     --response-file audit-packages/pr-<number>-round-<k>.md
   ```

   Run it as a background task and resume when the process exits. Use GPT-5.5 Pro / Pro Extended. Do not downgrade to non-Pro models, lower reasoning, or a different connector when the Pro run is slow or sticky; retry on Pro in a fresh thread instead. The repo defaults (`gpt-5.5-pro`, GitHub connector, connector-only context with no zip artifacts) are the intended configuration.
2. Check the captured response is the actual review before triaging it. If the response file is a short preliminary acknowledgment (for example "I'll inspect the PR and report back") instead of findings or an explicit no-findings summary, the model was still working when capture finished: the round does not count, and do not fire a new thread. Re-capture the finished reply from the same thread with `pnpm review:gpt thread export --chat-url <thread-url> --output audit-packages/pr-<number>-round-<k>-recapture.json` (the thread URL is in the run output) and read the final assistant message from that export. Note the conversation URL does not load (redirects home) while the turn is still generating, so wait a few minutes and retry the export until the thread loads.
3. When the response lands, verify every finding and suggested change against the actual code before acting, per the evidence-before-fix hard rule in `AGENTS.md`. Classify each as:
   - **Accepted bug/edge case** — confirmed real with code-path evidence or a focused reproduction.
   - **Accepted simplification** — the change removes more complexity than it adds and preserves behavior and invariants.
   - **Rejected** — wrong, already handled, speculative, or the proposed fix introduces more complexity than necessary. Note rejections briefly with the reason.
4. Fix all accepted findings, run the verification required by `agent-docs/operations/verification-and-runtime.md` for the touched owners, and push to the PR branch.
5. Fire the next round immediately after that push, in parallel with the new CI run. If CI later fails on a head a round reviewed, the round's findings still count; fix CI (rerunning flaky infra jobs is fine), and only changes that alter code beyond the reviewed diff require a fresh round.

## Base-Update-Only Exception

If a round has already reached zero accepted findings and the PR later needs to
be updated only because the base branch moved, do not start another external
review round just for that base update.

This exception applies only when the post-review change is a normal merge or
rebase of the PR base branch with no manual conflict resolution, new feature
work, review finding fix, or behavior/test/config/doc edit beyond the base
update itself. After the update, the merge path only needs PR CI green on the new
head; no review round is owed.

If the base update requires manual conflict resolution or any non-base-update
change, treat that as a normal PR-head change: run required verification for the
touched surface, push it, wait for CI, and then use the ordinary review-loop
rules.

## Stop Condition

- Stop when a round produces **zero accepted findings**. ChatGPT saying "looks clean" is not the terminator; the verification filter is.
- Hard cap: 5 rounds per PR. If the cap is hit with accepted findings still landing each round, stop and report that the PR likely needs structural rework rather than more review rounds.
- Report a per-round summary at handoff: findings received, accepted, rejected (with reasons), and what landed.

## Boundaries

- Never use this loop (or any `review:gpt`/`thread wake` flow) to satisfy required completion audits; see `agent-docs/operations/completion-workflow.md`.
- Response files under `audit-packages/` are local working artifacts and stay uncommitted.
- The managed browser profile, port, model, and connector defaults live in `scripts/review-gpt.config.sh`; the prompt lives in `scripts/chatgpt-review-presets/pr-deep-review.md`. Change them there, not inline.
