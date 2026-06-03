# Add 1000-line file composability rule

Status: completed
Created: 2026-06-02
Updated: 2026-06-02

## Goal

- Add a durable repo workflow rule that hand-authored files must not grow beyond 1,000 lines going forward.
- Make the rule touch-time: when implementation/docs/test/config work encounters a hand-authored file already over 1,000 lines, the task must split it along composable ownership seams before adding more surface.

## Success criteria

- `AGENTS.md` points agents at the 1,000-line hard rule.
- `agent-docs/operations/agent-workflow-routing.md` records the workflow expectation and current policy-vs-mechanics posture.
- `agent-docs/references/giant-file-composability-seams.md` carries the detailed split guidance.
- Changed Markdown is read back and the docs-only fast path is verified.

## Scope

In scope:

- Markdown-only process docs and this plan/ledger.

Out of scope:

- Immediate repo-wide inventory or refactor of all existing oversized files.
- New CI/script enforcement.

## Constraints

Technical constraints:

- Preserve unrelated working-tree edits.
- Do not manually split generated, vendored, lockfile, or tool-owned artifacts; address those through their generator or owning workflow.

Product/process constraints:

- Keep the rule simple and composability-focused rather than creating speculative architecture process.

## Risks and mitigations

1. Risk: A blanket 1,000-line statement could imply unsafe manual splitting of lockfiles or generated artifacts.
   Mitigation: Scope the touch-time split rule to hand-authored repo files and route generated/tool-owned oversized output through the owning tool.
2. Risk: Existing oversized files could block unrelated work if treated as an immediate repo-wide gate.
   Mitigation: Make the policy touch-time until a future mechanical guard can distinguish current-task files safely.

## Tasks

1. Add the rule to the visible repo hard rules.
2. Add workflow details to the durable routing docs.
3. Update the giant-file seam reference and docs index.
4. Read back the changed docs and verify the docs-only fast path.
5. Close the plan with a scoped commit.

## Decisions

- Use a touch-time policy instead of a repo-wide mechanical guard for this pass.

## Verification

Commands run:

- `sed` readback for touched Markdown files.
- `git diff --check`.
- `wc -l` on touched Markdown files.
- `pnpm typecheck`.
- `bash scripts/workspace-verify.sh test:diff AGENTS.md agent-docs/index.md agent-docs/operations/agent-workflow-routing.md agent-docs/references/giant-file-composability-seams.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md agent-docs/exec-plans/active/2026-06-02-line-count-composability-rule.md`.

Expected outcomes:

- Changed docs state the rule consistently.
- Diff has no whitespace errors.
- Touched files stay below the 1,000-line limit.
- Typecheck and scoped diff verification pass.

## Results

- Readback passed for the changed docs, active plan, and matching ledger row.
- `git diff --check` passed.
- `wc -l` confirmed all touched files are below 1,000 lines.
- `pnpm typecheck` passed.
- Scoped `test:diff` fast-path verification passed.
Completed: 2026-06-02
