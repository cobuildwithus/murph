# Render CI Deploy Gate

## Goal

Move the Render Temporal worker deploy trigger from Render's native
`checksPass` auto-deploy gate to a GitHub Actions post-CI deploy hook gate.

Success criteria:

- A workflow deploys `murph-temporal-worker` only after the required `main`
  push CI workflows pass for the same current `main` commit.
- The Render deploy hook remains a GitHub Actions secret and is never printed.
- Durable CI/deploy docs describe the new gate.

## Constraints

- Preserve unrelated dirty worktree edits and active execution-plan rows.
- Do not expose deploy hooks, tokens, user identifiers, or local paths.
- Do not let stale commits deploy after a newer `main` push.

## Plan

1. Add a post-CI GitHub Actions workflow for the Render Temporal worker.
2. Disable Render's native auto-deploy trigger in `render.yaml`.
3. Document the workflow, secret boundary, and verification expectations.
4. Validate workflow YAML/Blueprint and run required repo checks.
