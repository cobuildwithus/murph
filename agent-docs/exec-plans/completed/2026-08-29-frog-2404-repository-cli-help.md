# Restore repository CLI help from clean worktrees

Status: completed
Created: 2026-08-29
Updated: 2026-08-29

## Goal

- Provide one repository-owned Vault CLI development command that renders
  nested help in a freshly installed task worktree without requiring workspace
  `dist` output or a global `vault-cli` install.

## Success criteria

- `pnpm vault-cli meal edit --help` succeeds while workspace package `dist`
  directories are absent.
- The existing root `chat` developer shortcut delegates through the same
  source-resolving launcher.
- Repository docs advertise the working launcher, and focused regression proof
  prevents removal of the explicit root tsconfig binding.

## Scope

- In scope: root development scripts, focused repo-tool coverage, and the
  existing README quick-help example.
- Out of scope: published CLI packaging, command behavior, global installation,
  workspace build topology, and any product/runtime behavior.

## Constraints

- Technical constraints: resolve sibling workspace packages from source through
  the committed root tsconfig; do not add a dependency, build-on-demand layer,
  or duplicate CLI implementation.
- Product/process constraints: keep the patch developer-tooling-only, preserve
  the canonical built-CLI verification path, and follow the Frog PR/review/CI
  landing workflow.

## Risks and mitigations

1. Risk: a launcher that works only because local `dist` artifacts exist could
   hide the original defect.
   Mitigation: prove the direct scenario in this clean worktree before any
   workspace build and assert the launcher retains `--tsconfig
   tsconfig.base.json`.
2. Risk: `pnpm chat` drifts onto a second source entrypoint.
   Mitigation: make it delegate to the single `vault-cli` package script and
   cover both script contracts together.

## Tasks

1. Reproduce the clean-worktree failure and trace module resolution.
2. Add the minimal root development launcher and update its existing callers
   and documentation.
3. Run direct no-`dist` help proof, focused tests, typecheck, and diff checks.
4. Commit, push, open the draft PR, complete exact-head ReviewGPT and CI, then
   land only if every scheduled low-risk gate remains satisfied.

## Decisions

- Use a root package script instead of a new wrapper process: pnpm already owns
  repository dependency installation and argument forwarding, while the one
  missing contract is explicit root tsconfig selection for source aliases.
- Keep `pnpm chat` as a convenience alias, but route it through the same root
  launcher so the repository has one source-resolution contract.

## Verification

- Commands to run: `pnpm vault-cli meal edit --help`; focused repo-tool test for
  the launcher contract; `pnpm --dir packages/cli typecheck`; `git diff
  --check`; repository-selected diff verification.
- Expected outcomes: help renders the canonical `vault-cli meal edit` usage
  without workspace builds; focused and selected checks pass.
- Results:
  - Exact no-`dist` reproduction: the prior raw `pnpm exec tsx
    packages/cli/src/bin.ts meal edit --help` exits 1 while resolving
    `@murphai/runtime-state/node/sqlite-warning-filter` through absent build
    output.
  - Exact no-`dist` repair proof: `pnpm vault-cli meal edit --help` exits 0 and
    renders `Usage: vault-cli meal edit <id> [options]`.
  - Focused launcher contract: 2/2 tests passed.
  - `pnpm --dir packages/cli typecheck`: passed.
  - `git diff --check`: passed.
  - Optional whole `pnpm test:repo-tools` did not complete after more than eight
    minutes in an existing repository-tool worker and was interrupted; the
    focused changed test had already passed independently. Exact-head CI remains
    the broad-suite owner for this PR lane.
Completed: 2026-08-29
