# CLI release flow

Status: completed
Created: 2026-03-13
Updated: 2026-03-13

## Goal

- Add a user-operated npm release flow for `@healthybob/cli` that mirrors the established `../cli` process, but is adapted safely to this monorepo by targeting `packages/cli` as the releasable package instead of the private workspace root.

## Success criteria

- `packages/cli` has package-aware `release.sh`, `update-changelog.sh`, and `generate-release-notes.sh` scripts that operate on `packages/cli` artifacts instead of the private workspace root.
- The root `package.json` exposes release proxy commands (`release:check`, `release:dry-run`, `release:patch`, `release:minor`, `release:major`, `release:notes`, `changelog:update`) that delegate to `packages/cli`.
- `packages/cli/package.json` is publish-ready for npm (non-private, publish metadata, release scripts, release-check command).
- A GitHub release workflow exists and validates/publishes `packages/cli` using tag/version/package identity checks before publish.
- Package-local docs describe the release flow truthfully, including any current publishability guardrails.
- Tests cover the release script guard behavior and workflow guardrails closely enough to catch drift.

## Scope

- In scope:
- package-scoped release scripts under `packages/cli/scripts`
- root proxy scripts under `scripts/` and root `package.json`
- package metadata for `@healthybob/cli`
- package-local README release usage
- release workflow and focused release-flow tests
- safe release-artifact handling in the root docs-drift wrapper
- Out of scope:
- running an actual release, version bump, tag push, or npm publish
- changing active contracts/storage-spine implementation lanes
- redesigning the product/package structure beyond what is required to publish `@healthybob/cli`

## Constraints

- Technical constraints:
- Respect active ownership: do not touch `packages/contracts/**`, `packages/core/**`, `packages/importers/**`, `packages/query/**`, or `packages/cli/src/**`.
- The upstream repo-tools release/changelog/notes helpers are git-root scoped, so the healthybob adaptation must reimplement the same behavior with explicit `packages/cli` paths instead of calling those helpers directly.
- Keep release behavior user-operated; do not execute release/version/publish flows themselves.
- Product/process constraints:
- Mirror `../cli` closely where compatible, but do not copy Cobuild-specific package names, repository URLs, or published-wire checks that do not apply here.
- Avoid files owned by other active lanes even if they would normally be good documentation targets; keep the release docs local to `packages/cli` for this pass.
- Because this touches production scripts/tests/workflows, run completion-workflow audit passes after implementation.

## Risks and mitigations

1. Risk: Copying `../cli` literally would wire the release helper to the wrong package (`healthybob` root instead of `@healthybob/cli`).
   Mitigation: use package-aware scripts that pin `packages/cli/package.json`, `packages/cli/CHANGELOG.md`, and `packages/cli/release-notes/`, then expose only thin root proxies.
2. Risk: Release tests or workflow assertions can become brittle if they depend on unrelated workspace behavior.
   Mitigation: keep tests narrowly scoped to package identity, docs gates, and command ordering, with monorepo-aware fixtures.
3. Risk: `@healthybob/cli` currently depends on private `workspace:*` packages, so an npm publish would be unsafe or broken.
   Mitigation: add an explicit publish-readiness guard that fails release checks until the dependency graph is publishable.
4. Risk: Current worktree dirt from other lanes could interfere with release-flow verification.
   Mitigation: limit touched files to the claimed scope, use targeted release tests during development, then run the required repo checks at the end.

## Tasks

1. Port the `../cli` release behavior into package-aware scripts under `packages/cli` with healthybob-specific package metadata and publish-readiness guards.
2. Add root proxy scripts and package commands that delegate release operations into `packages/cli`.
3. Add a release workflow and package-scoped docs/release-notes scaffolding.
4. Add release-flow tests adapted from `../cli` and wire them into the root Vitest suite.
5. Run completion-workflow audits, then run required repo checks.

## Decisions

- The releasable package is `packages/cli` (`@healthybob/cli`), not the private workspace root.
- Root-level release commands will proxy into `packages/cli` for convenience, but package-local release metadata remains the source of truth.
- The upstream repo-tools release/changelog/notes helpers are too git-root-centric for this monorepo, so the final implementation mirrors their behavior with package-aware scripts instead of invoking them directly.
- The release flow keeps an explicit publish-readiness guard because `@healthybob/cli` still depends on private `workspace:*` packages.

## Outcome

- Done: package-scoped release scripts, root proxy commands, workflow, package docs, release artifacts scaffolding, release-flow tests, and a docs-drift allowance for package-local release artifact commits.
- Verification: `pnpm exec vitest run packages/cli/test/release-script-coverage-audit.test.ts packages/cli/test/release-workflow-guards.test.ts --no-coverage --maxWorkers 1`, `pnpm test`, and `pnpm test:coverage` passed.
- Verification: `pnpm typecheck` failed in the active Zod/contracts lane with `packages/contracts/scripts/*` unable to resolve `@healthybob/contracts/schemas`; no release-flow files participate in that import path.

## Verification

- Commands to run:
- `pnpm exec vitest run packages/cli/test/release-script-coverage-audit.test.ts packages/cli/test/release-workflow-guards.test.ts --no-coverage --maxWorkers 1`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- completion workflow audit passes using:
- `agent-docs/prompts/simplify.md`
- `agent-docs/prompts/test-coverage-audit.md`
- `agent-docs/prompts/task-finish-review.md`
- Expected outcomes:
- Release wrapper scripts stay thin and deterministic.
- Workflow/package identity checks fail fast if the release target drifts away from `@healthybob/cli`.
- Docs and verification references describe the actual release path instead of the old “no CI/workflow” state.
Completed: 2026-03-13
