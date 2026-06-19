# ReviewGPT Loop Guidance

Status: completed
Created: 2026-06-19
Updated: 2026-06-19

## Goal

- Tighten the PR-lane ReviewGPT workflow so it caps at 10 rounds, requires local fix-worthiness and complexity triage before accepting findings, and requires a production-faithful repro before fixing accepted bugs.

## Success criteria

- `agent-docs/operations/pr-deep-review-loop.md` documents the 10-round cap and the local triage/repro-before-fix sequence.
- `agent-docs/index.md` matches the new cap summary.
- `scripts/chatgpt-review-presets/pr-deep-review.md` stays outcome-first and aligned with the supplied GPT-5.5 prompt guidance.
- Text readback and required docs verification pass.

## Scope

- In scope: PR ReviewGPT loop docs, docs index summary, and the PR ReviewGPT preset text.
- Out of scope: ReviewGPT tool implementation changes, historical completed plans, Murph Age scientific ReviewGPT gates, and non-PR review presets.

## Constraints

- Technical constraints: text-only docs/prompt changes; do not alter runtime code or package scripts unless a hard-coded cap is found.
- Product/process constraints: preserve the GitHub-connector PR review model and keep local agents responsible for verification before fixing.

## Risks and mitigations

1. Risk: The new repro rule becomes a broad testing mandate for non-bug simplifications.
   Mitigation: Scope the production-faithful repro requirement to accepted bugs and edge cases; simplifications still require behavior/invariant proof.
2. Risk: The ReviewGPT prompt becomes process-heavy.
   Mitigation: Keep it outcome-first, short, and focused on high-impact findings and validation hints.

## Tasks

1. Done: Update ReviewGPT loop docs and index cap from 15 to 10.
2. Done: Add local triage/repro-before-fix guidance for received findings.
3. Done: Tighten the PR review preset using supplied GPT-5.5 prompt guidance.
4. Done: Read back touched files and run required verification.
5. Next: Close the plan with a scoped commit.

## Decisions

- Use docs/process-only text fast path plus `pnpm typecheck` because the plan includes a prompt preset under `scripts/**`.

## Verification

- Passed: read back touched files.
- Passed: `rg -n "15 rounds|15 review|fifteen|Hard cap: 15|stop at zero accepted findings or 15" agent-docs scripts --glob '!agent-docs/exec-plans/completed/**'` found no live references.
- Passed: `git diff --check`.
- Passed: `bash scripts/workspace-verify.sh test:diff agent-docs/operations/pr-deep-review-loop.md agent-docs/index.md scripts/chatgpt-review-presets/pr-deep-review.md agent-docs/exec-plans/active/2026-06-19-reviewgpt-loop-guidance.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`.
- Passed: `pnpm docs:drift`.
- Blocked by unrelated existing failure: `pnpm typecheck` fails in `packages/assistant-cli` because `ASSISTANT_NO_REPLY_TRANSCRIPT_MARKER_PREFIX` is imported from `@murphai/assistant-engine/assistant-provider` but is not exported there. This task touched only Markdown docs/prompt files.
Completed: 2026-06-19
