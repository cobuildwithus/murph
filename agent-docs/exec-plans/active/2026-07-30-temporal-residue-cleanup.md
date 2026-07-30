# Temporal residue cleanup

Status: active
Created: 2026-07-30
Updated: 2026-07-30

## Goal

- Remove obsolete public test and process residue left after the Temporal
  production worker moved to private Murph Cloud, without changing runtime
  behavior or replay compatibility.

## Success criteria

- Public tests no longer mock deleted direct-runner nudge modules or assert
  against their retired functions.
- The stale hosted-ingress wake plan is no longer marked active.
- Focused affected tests and the public Temporal architecture guard pass.
- No production Temporal Workflow, Schedule, patch marker, Render capacity, or
  private deployment ownership changes.

## Scope

- In scope:
  - Remove dead mocks, setup, and assertions for the deleted
    `hosted-runner/control` and `hosted-runner/assistant-nudge` modules.
  - Archive the stale `2026-06-09-hosted-ingress-wake-repair` active plan.
  - Remove already-merged migration branch residue after the cleanup PR is
    established.
- Out of scope:
  - Temporal Workflow or Activity behavior.
  - Render services or instance count.
  - Temporal Schedule or patch-marker removal.
  - Forcing a public npm release solely to remove the private registry-version
    type bridge.

## Constraints

- Technical constraints:
  - Preserve current test behavior and production architecture guards.
  - Keep the public repository free of a production Temporal worker or deploy
    path.
- Product/process constraints:
  - Work from an isolated PR worktree.
  - Preserve unrelated local changes.

## Risks and mitigations

1. Risk: removing a mock still used by an imported code path could make focused
   tests fail at module resolution or change their assertions.
   Mitigation: remove only mocks for modules absent from tracked production
   source, then run every affected test file together.
2. Risk: cleanup accidentally removes live replay/versioning protection.
   Mitigation: do not touch Murph Cloud workflow code, Temporal patch markers,
   the global Schedule, or Render configuration.

## Tasks

1. Remove obsolete test-only nudge mocks, resets, setup, and assertions.
2. Archive the stale active plan.
3. Run focused tests and architecture guards.
4. Complete the required PR review and CI path.

## Decisions

- Treat the two live Render instances as intentional capacity, not duplication.
- Defer the private exact-pin type bridge to the next ordinary public package
  release; publishing all public packages is not proportional to test/process
  residue cleanup.

## Verification

- Commands to run:
  - Focused Vitest for all five affected Web test files.
  - `pnpm hosted-temporal:guard`.
  - `git diff --check`.
- Expected outcomes:
  - All focused tests and guards pass with no tracked production-code change.
