# 2026-06-11 PR Deep-Review Loop

## Goal

- Switch the default `review:gpt` managed browser profile from Phlebas to Eragon on its own CDP port.
- Add a `pr-review` preset with the deep PR-review prompt (bugs, edge cases, minimal-complexity architecture).
- Document the post-CI PR deep-review loop as a durable agent workflow stage: fire `pnpm review:gpt pr-review` with the PR link, wait for the response, verify each finding, land only accepted fixes/simplifications, then repeat on a fresh thread until a round yields zero accepted findings (cap 5 rounds).

## Scope

- `scripts/review-gpt.config.sh`
- `scripts/chatgpt-review-presets/pr-deep-review.md`
- `agent-docs/operations/pr-deep-review-loop.md`
- `agent-docs/operations/completion-workflow.md`
- `agent-docs/index.md`

## Constraints

- The loop is a post-CI stage, not a substitute for required completion audits (`completion-workflow.md` prohibition stays intact).
- Connector-only context (GitHub connector, no zip artifacts); model/thinking stay on CLI defaults (`gpt-5.5-pro` → Extended Pro).
- No new scripts or code; the loop is agent procedure.

## Verification

- `pnpm review:gpt pr-review --dry-run` resolves the new preset and Eragon profile.
- Release-script coverage test still passes.
Status: completed
Updated: 2026-06-11
Completed: 2026-06-11
