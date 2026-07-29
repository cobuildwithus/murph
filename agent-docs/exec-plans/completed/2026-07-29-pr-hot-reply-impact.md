# Require hot reply path impact in PR bodies

Status: completed
Created: 2026-07-29
Updated: 2026-07-29

## Goal

- Make every PR state whether it changes the foreground reply critical path.
- When it does, require a concrete account of added database, network, and
  other awaited latency.

## Success criteria

- The PR template contains a dedicated hot reply path section.
- The completion workflow defines the section as required and ties its scope to
  the canonical foreground reply critical path.
- Affected PRs disclose call counts, ordering, timeouts or fallback behavior,
  and focused proof; unaffected PRs state why the section is not applicable.

## Scope

- `.github/pull_request_template.md`
- `agent-docs/index.md`
- `agent-docs/operations/completion-workflow.md`

## Constraints

- Reuse the existing critical-path definition in
  `docs/contracts/00-invariants.md`.
- Add no runtime, CI, or review service.
- Keep the section short enough to complete on every PR.

## Tasks

1. [x] Add the required section to the PR template.
2. [x] Add the matching required PR-description contract.
3. [x] Read back the rendered structure and inspect the final diff.
4. [x] Run the routed verification and close the plan with a scoped commit.

## Verification log

- `git diff --check`
  - Passed.
- Direct heading and field readback with `rg`
  - Passed: the template, workflow contract, and canonical invariant use the
    same critical-path boundary.
- `pnpm docs:drift`
  - Passed after installing the worktree's dependency links from the ordinary
    shared pnpm store.
- Parent final review
  - No findings. The change adds one required disclosure section, reuses the
    existing critical-path definition, and adds no runtime or CI mechanism.
Completed: 2026-07-29
