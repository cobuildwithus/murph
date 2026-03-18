# Monorepo release flow

Status: completed
Created: 2026-03-18
Updated: 2026-03-18

## Goal

- Replace the current CLI-only npm release path with a Healthy Bob-specific fixed-version monorepo release flow that versions, packs, and publishes the selected workspace packages together under one git tag.

## Success criteria

- Root release commands are driven by a single manifest that defines the publish set, shared-version policy, dependency-aware publish order, and primary package.
- `pnpm release:check` verifies repo checks, shared version alignment, publish metadata, and `pnpm pack` output for every publishable package.
- `pnpm release:patch|minor|major` bumps all publishable packages together, updates release artifacts, commits the intended files, and tags the release without relying on the old package-local CLI scripts.
- The publish workflow validates the tag against the manifest/package set, packs all publishables, uploads all tarballs, attaches them to the GitHub release, and publishes sequentially with idempotent handling.
- The published CLI package is `healthybob` with both `healthybob` and `vault-cli` bins, while `@healthybob/web` stays private.
- Release docs/tests reflect the monorepo flow truthfully.

## Scope

- In scope:
- root release scripts, manifest, workflow, and release verification helpers
- package metadata for the publishable package set
- release README/changelog/release-notes handling
- focused release-flow tests and process docs
- Out of scope:
- actually running a release, tag push, or npm publish
- changing runtime package source behavior outside metadata/docs/tests needed for release
- publishing `@healthybob/device-syncd` in this first cut unless repo wiring forces it

## Constraints

- Keep one shared version across the publishable package set.
- Use workspace-aware `pnpm pack`/tarball publishing instead of the old `npm pack` single-package assumption.
- Preserve repo-tools-style ergonomics where useful, but keep publish/version logic repo-local.
- Keep `@healthybob/web` private and avoid touching unrelated source lanes.
- Update architecture/verification docs in the same change because the release/runtime surface is changing materially.

## Risks and mitigations

1. Risk: package metadata drifts from the manifest and breaks publish order or tag validation.
   Mitigation: add manifest-driven verification and focused workflow/script tests.
2. Risk: cross-cutting release changes conflict with in-progress runtime work.
   Mitigation: keep the edit set release/package-doc/test focused and avoid package source files.
3. Risk: release scripts mutate the wrong files or version only part of the publish set.
   Mitigation: derive file targets from the manifest and assert shared-version alignment before tagging.
4. Risk: workflow/publish is non-idempotent.
   Mitigation: publish tarballs sequentially and treat already-published versions as success.

## Tasks

1. Add the active coordination lane and this execution plan.
2. Introduce a root release manifest plus manifest-driven verify/pack/publish helpers.
3. Convert release/version/changelog/release-notes scripts from CLI-only assumptions to the shared publish set.
4. Update package metadata, docs, and workflow for the new publish model.
5. Refresh focused release tests, run required audits/checks, then commit and clear the ledger row.

## Decisions

- The primary published package will be `healthybob` from `packages/cli`.
- The first publishable set is `@healthybob/contracts`, `@healthybob/runtime-state`, `@healthybob/core`, `@healthybob/query`, `@healthybob/importers`, `@healthybob/inboxd`, `@healthybob/parsers`, and `healthybob`.
- `@healthybob/web` remains private.
- `@healthybob/device-syncd` stays out of the first publish set.

## Verification

- Required repo checks: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`
- Completion workflow audits: simplify, test-coverage-audit, task-finish-review

## Outcome

- Done: replaced the old CLI-only release flow with a root-owned fixed-version monorepo release flow driven by `scripts/release-manifest.json`.
- Done: renamed the published CLI package to `healthybob`, marked the publish set public, pinned `@photon-ai/imessage-kit`, added the missing `packages/runtime-state/README.md`, and rewired the release workflow/scripts/tests/docs around `pnpm pack`.
- Verification:
- `pnpm exec vitest run packages/cli/test/release-script-coverage-audit.test.ts packages/cli/test/release-workflow-guards.test.ts --no-coverage --maxWorkers 1` passed.
- `node scripts/pack-publishables.mjs --clean --out-dir <temp>/tarballs --pack-output <temp>/pack-output.json` passed and produced tarballs for all manifest packages.
- `pnpm typecheck` passed.
- `pnpm release:check` failed in unrelated existing CLI tests before the release check reached its final pack step.
- `pnpm test:coverage` failed with the same unrelated existing CLI test failures.

## Blocking verification failures

1. `packages/cli/test/assistant-service.test.ts`
   `buildResolveAssistantSessionInput keeps locator shaping and operator default fallbacks stable` now receives an extra `maxSessionAgeMs: null` field.
2. `packages/cli/test/runtime.test.ts`
   `inbox attachment commands expose stored metadata, parse status, and requeue support` fails because the active inbox/iMessage lane now requires readable `~/Library/Messages/chat.db`.
3. `packages/cli/test/runtime.test.ts`
   `inbox journal and experiment-note promotions are idempotent` fails for the same iMessage readiness reason.

Completed: 2026-03-18
