# 2026-04-09 Release Check Regressions

## Goal

Restore the currently failing release-check coverage around setup wizard rendering, Linux setup apt fallback, and experiment/journal date expectations so the reported CI failures pass on the current tree.

## Scope

- `packages/setup-cli/**`
- `packages/cli/**`
- Supporting lower-layer code only if one of the failing behaviors is owned outside those packages.

## Constraints

- Preserve unrelated in-flight worktree edits.
- Keep the diff proportional to the failing surfaces.
- Run required verification after implementation and before handoff.
- Run the required final audit pass before commit/handoff.

## Verification

- Focused failing-test reproduction first.
- Then repo-required verification for the touched surfaces.

## Notes

- Primary targets from CI report:
  - setup wizard intro/public-links/OpenAI prompt output missing under TTY tests
  - Linux setup should not invoke apt when unavailable
  - CLI experiment `endedOn` date shifted one day earlier than expected
Status: completed
Updated: 2026-04-09
Completed: 2026-04-09
