# hosted-local-worktree-helper

Status: completed
Created: 2026-06-22
Updated: 2026-06-22

## Goal

- Implement a first-class hosted-local worktree helper so agents can run the
  hosted dev stack from a secondary git worktree with isolated ports, temp
  state, local database naming, webhook registration cache, and runner cleanup
  scope.

## Success criteria

- `pnpm hosted-local worktree env|doctor|up <slug>` and
  `pnpm dev:worktree <slug>` are documented and route through the existing
  hosted-local harness.
- The `worktree` hosted-local profile preserves live Stripe/Linq behavior while
  avoiding global `.dev.vars` symlinks and broad runner cleanup.
- Focused tests cover slug validation, deterministic env derivation, profile
  behavior, and CLI routing.
- Verification covers the hosted-local harness package, root typecheck, and a
  direct non-secret command smoke.

## Scope

- In scope:
  - `packages/hosted-local-harness` CLI/profile/config/state helpers and tests.
  - Root script alias and durable docs for the worktree helper contract.
  - Minimal cleanup support that is safe to run by slug/build id.
- Out of scope:
  - A new process supervisor, background daemon, or generic port manager.
  - Production hosted runtime behavior changes.
  - Live provider webhook registration or paid model/provider calls.

## Constraints

- Technical constraints:
  - Keep implementation inside the existing hosted-local harness.
  - Do not print or persist secret values; use existing redaction helpers for
    command/state output.
  - Keep worktree state under ignored local `.tmp/hosted-local-worktrees/<slug>`
    paths.
  - Avoid broad Docker runner cleanup for worktree stacks.
- Product/process constraints:
  - Preserve unrelated working-tree changes and active hosted runner lanes.
  - Keep architecture simple and composable; no speculative orchestration layer.
  - Finish with the repo-required audit, verification, commit, and PR path.

## Risks and mitigations

1. Risk: Helper accidentally disables live webhook/Stripe behavior by reusing E2E
   isolation.
   Mitigation: Add a distinct `worktree` profile and tests for the profile env.
2. Risk: Worktree startup disturbs the main dev stack's runner containers or
   generated `.dev.vars`.
   Mitigation: Scope runner cleanup by build id and disable the global symlink
   path for the worktree profile.
3. Risk: Helper output leaks local secrets or direct personal identifiers.
   Mitigation: Print only non-secret derived values and rely on redacted hosted
   local state rendering for diagnostics.

## Tasks

1. Inspect existing hosted-local harness startup/profile/cleanup code.
2. Add worktree config derivation, manifest, CLI commands, and profile defaults.
3. Wire Linq registration cache and cleanup/symlink behavior to the worktree
   profile.
4. Add focused tests and docs/script alias updates.
5. Run package and repo verification plus direct helper smoke.
6. Run required audits, resolve findings, finish task, and open draft PR.

## Decisions

- Use a distinct `worktree` profile rather than overloading E2E isolation,
  because E2E intentionally disables live webhook and Stripe surfaces.
- Keep the command as a thin layer over `pnpm hosted-local up` primitives instead
  of adding a second shell runner.

## Verification

- Commands to run:
  - `git diff --check`
  - `pnpm --dir packages/hosted-local-harness test`
  - `pnpm --dir packages/hosted-local-harness test:coverage`
  - `pnpm typecheck`
  - `pnpm test:diff <touched paths>`
  - Direct smoke: `pnpm hosted-local worktree env <slug>` and
    `pnpm hosted-local worktree doctor <slug>`
- Expected outcomes:
  - All required commands pass, or any unrelated blocker is documented with
    exact failing target and why this diff did not cause it.
Completed: 2026-06-22
