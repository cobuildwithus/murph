# PR Deep-Review Loop

Last verified: 2026-06-12

Required external deep-review loop that runs after the repo-required completion workflow, on PR-lane work.
It is additive: it never satisfies, replaces, or reorders the required completion audits in `agent-docs/operations/completion-workflow.md`.
For non-trivial PR-lane work, do not call the PR good to merge until this loop has passed.

## When It Runs

Run the loop when all of the following hold:

1. The task used the worktree/PR lane and a PR is open.
2. All routed completion audits passed and the scoped commit is pushed.
3. The PR CI checks are green (`gh pr checks <pr>`).
4. The user has not explicitly opted out in the current task.

Skip it only for docs/process-only PRs, trivial copy-only changes, or explicit current-task user opt-out.

## One Round

1. Fire a new ChatGPT thread (never reuse a thread between rounds; omitting `--chat-url` creates a fresh one):

   ```sh
   pnpm review:gpt pr-review \
     --prompt "PR: <pr-url>" \
     --send --wait --wait-timeout 60m \
     --response-file audit-packages/pr-<number>-round-<k>.md
   ```

   Run it as a background task and resume when the process exits. Do not override `--model`, `--thinking`, or the connector: the defaults (GPT Extended Pro, GitHub connector, connector-only context with no zip artifacts) are the intended configuration.
2. When the response lands, verify every finding and suggested change against the actual code before acting, per the evidence-before-fix hard rule in `AGENTS.md`. Classify each as:
   - **Accepted bug/edge case** — confirmed real with code-path evidence or a focused reproduction.
   - **Accepted simplification** — the change removes more complexity than it adds and preserves behavior and invariants.
   - **Rejected** — wrong, already handled, speculative, or the proposed fix introduces more complexity than necessary. Note rejections briefly with the reason.
3. Fix all accepted findings, run the verification required by `agent-docs/operations/verification-and-runtime.md` for the touched owners, and push to the PR branch.
4. Wait for PR CI to go green again before starting the next round.

## Stop Condition

- Stop when a round produces **zero accepted findings**. ChatGPT saying "looks clean" is not the terminator; the verification filter is.
- Hard cap: 5 rounds per PR. If the cap is hit with accepted findings still landing each round, stop and report that the PR likely needs structural rework rather than more review rounds.
- Report a per-round summary at handoff: findings received, accepted, rejected (with reasons), and what landed.

## Boundaries

- Never use this loop (or any `review:gpt`/`thread wake` flow) to satisfy required completion audits; see `agent-docs/operations/completion-workflow.md`.
- Response files under `audit-packages/` are local working artifacts and stay uncommitted.
- The managed browser profile, port, model, and connector defaults live in `scripts/review-gpt.config.sh`; the prompt lives in `scripts/chatgpt-review-presets/pr-deep-review.md`. Change them there, not inline.
