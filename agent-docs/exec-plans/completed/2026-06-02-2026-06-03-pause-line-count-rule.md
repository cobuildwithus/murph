# Pause 1000-line workflow rule

Status: completed
Created: 2026-06-02
Updated: 2026-06-02

## Goal

- Pause the repo's active 1,000-line hand-authored file split requirement so agents no longer treat oversized files as an automatic refactor blocker.

## Success criteria

- `AGENTS.md` no longer carries the hard rule.
- The workflow router marks the 1,000-line touch-time policy as paused rather than enforceable.
- The giant-file reference remains as planning guidance only.
- Touched docs are read back and the change is committed through the plan flow.

## Scope

- In scope: `AGENTS.md`, workflow routing docs, docs index text, giant-file planning guidance.
- Out of scope: code changes, CI guard changes, broad giant-file cleanup, historical completed-plan rewrites.

## Constraints

- Technical constraints: markdown-only docs/process change.
- Product/process constraints: preserve unrelated dirty worktree edits and keep local identifiers out of committed docs.

## Risks and mitigations

1. Risk: Removing only the AGENTS bullet leaves lower-precedence docs still enforcing the threshold.
   Mitigation: Update the workflow router and reference doc to mark the policy paused.

## Tasks

1. Remove the hard rule from `AGENTS.md`.
2. Mark the workflow-router 1,000-line policy as paused.
3. Update the giant-file reference and docs index.
4. Read back touched docs and run required verification.

## Decisions

- Keep the giant-file reference doc because it still contains useful planning notes; change it from active policy to paused guidance.

## Verification

- Direct markdown readback passed.
- `rg` stale active-policy phrase check passed.
- `git diff --check -- AGENTS.md agent-docs/operations/agent-workflow-routing.md agent-docs/index.md agent-docs/references/giant-file-composability-seams.md agent-docs/exec-plans/active/2026-06-02-2026-06-03-pause-line-count-rule.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md` passed.
- `pnpm typecheck` passed.
- `bash scripts/workspace-verify.sh test:diff AGENTS.md agent-docs/index.md agent-docs/operations/agent-workflow-routing.md agent-docs/references/giant-file-composability-seams.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md agent-docs/exec-plans/active/2026-06-02-2026-06-03-pause-line-count-rule.md` passed.
Completed: 2026-06-02
