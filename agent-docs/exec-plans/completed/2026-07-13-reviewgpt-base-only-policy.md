# ReviewGPT Base-Only Update Policy

## Goal

Make the completion policy unambiguous: once ReviewGPT has accepted a PR-specific
patch, a later update that changes only the base branch does not invalidate that
audit. Agents rerun CI after the base update and rerun ReviewGPT only when the
PR-specific patch changes or conflict resolution edits the patch.

## Scope

- `AGENTS.md`
- `agent-docs/index.md`
- `agent-docs/operations/completion-workflow.md`
- Direct recovery-owner notification and acknowledgement

## Verification

- Read back both policy locations and the canonical index, then search for contradictory rerun guidance.
- Run the Markdown-only docs/process verification path: diff readback,
  `git diff --check`, and relevant reference searches.

## Completion

- Notify every currently active recovery owner.
- Close this plan and its coordination-ledger row in the scoped commit.
Status: completed
Updated: 2026-07-13
Completed: 2026-07-13
