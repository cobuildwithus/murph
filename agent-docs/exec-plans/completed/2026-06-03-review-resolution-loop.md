# Review Resolution Loop

Status: completed
Created: 2026-06-03
Updated: 2026-06-03

## Goal

- Make the Murph completion-audit workflow explicitly loop on audit findings
  until no unresolved accepted/actionable findings remain.

## Success criteria

- `agent-docs/operations/completion-workflow.md` defines the parent-agent
  finding lifecycle: verify, accept/reject, fix narrowly, rerun proof, and
  rerun affected audits when warranted.
- The Murph completion-audits skill mirrors that routing contract.
- Required docs/process verification passes for the touched Markdown files.

## Scope

- In scope:
  - `agent-docs/operations/completion-workflow.md`
  - Murph completion-audits skill instructions
  - this execution plan and matching coordination-ledger row
- Out of scope:
  - new external review engines, `review:gpt`, thread-wake/autosend flows, or
    broad reviewer panels
  - changes to implementation code, tests, or runtime audit tooling

## Constraints

- Technical constraints:
  - Keep the loop bounded to accepted/actionable findings; do not require
    endless reruns for rejected, speculative, or out-of-scope findings.
  - Preserve existing required audit pass routing and fast paths.
- Product/process constraints:
  - Preserve the repo's local Codex subagent workflow as source of truth.
  - Do not add unnecessary audit layers or new tooling abstractions.

## Risks and mitigations

1. Risk: "Loop until clean" could cause runaway repeated audits.
   Mitigation: define the stopping condition as no unresolved
   accepted/actionable findings, with affected-pass reruns only when fixes
   materially change the relevant risk surface.
2. Risk: Agents may blindly apply audit suggestions.
   Mitigation: require parent-agent verification against the real code path
   before accepting any finding.

## Tasks

1. Done: Register the docs/process lane in the coordination ledger.
2. Done: Update the completion workflow with a review-resolution loop.
3. Done: Update the Murph completion-audits skill to route the same loop.
4. Done: Read back touched docs and run required checks.
5. Now: Close the plan through the scoped commit path if safe.

## Decisions

- Adopt the `autoreview` discipline as workflow policy, not as a new default
  review tool or pass.
- Stop after no unresolved accepted/actionable findings remain; rejected
  findings need a concise reason, not another reviewer.

## Verification

- Commands to run:
  - `git diff --check -- agent-docs/operations/completion-workflow.md agent-docs/exec-plans/active/2026-06-03-review-resolution-loop.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
  - `pnpm typecheck`
  - read back touched Markdown files
- Expected outcomes:
  - No whitespace errors.
  - Typecheck passes or any unrelated blocker is reported precisely.
  - Touched docs state the same loop contract without conflicting wording.
- Results:
  - Passed: readback of `agent-docs/operations/completion-workflow.md`, this
    plan, `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`, and the Murph
    completion-audits skill.
  - Passed: `git diff --check -- agent-docs/operations/completion-workflow.md agent-docs/exec-plans/active/2026-06-03-review-resolution-loop.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`.
  - Passed: touched-file redaction check for local path/user-name leakage.
  - Passed: `pnpm typecheck`.
  - Passed: `pnpm test:diff agent-docs/operations/completion-workflow.md agent-docs/exec-plans/active/2026-06-03-review-resolution-loop.md`.
Completed: 2026-06-03
