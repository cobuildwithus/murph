# ReviewGPT ZIP Attachments

## Goal

Make PR ReviewGPT use repo ZIP plus repomix attachments by default, through the
Eragon browser lane, and remove GitHub connector dependency from the PR deep
review prompt and workflow docs.

## Scope

- `scripts/review-gpt.config.sh`
- `scripts/review-gpt-pr-head-preflight.sh`
- `scripts/chatgpt-review-presets/pr-deep-review.md`
- `agent-docs/operations/completion-workflow.md`
- `agent-docs/operations/pr-deep-review-loop.md`
- focused guard tests that assert ReviewGPT config defaults

## Constraints

- Preserve unrelated local edits, including the existing managed browser port
  change in `scripts/review-gpt.config.sh`.
- Keep the prompt outcome-first and aligned with GPT-5.5 guidance.
- Do not update historical completed-plan snapshots.
- Do not include local personal paths or identifiers in committed artifacts.

## Verification

- Prompt review pass for prompt-primary behavior.
- `pnpm typecheck` plus direct checks/readback for touched tooling files.

## State

- Done: prompt/config/docs updated for ZIP and repomix attachment context.
- Done: prompt-review accepted two findings; added pushed-head preflight and
  Eragon no-connector guidance.
- Now: rerun focused verification.
- Next: final local review and finish-task.
Status: completed
Updated: 2026-06-26
Completed: 2026-06-26
