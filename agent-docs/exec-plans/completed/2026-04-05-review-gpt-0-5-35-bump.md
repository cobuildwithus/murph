# Bump review-gpt to 0.5.35

Status: completed
Created: 2026-04-05
Updated: 2026-04-05

## Goal

- Update Murph to the published `@cobuild/review-gpt@0.5.35` release after the upstream watcher hardening release landed.
- Keep the downstream change scoped to dependency metadata, lockfile, and the required version-scoped release-age exception.

## Success criteria

- Root `package.json`, `pnpm-lock.yaml`, and `pnpm-workspace.yaml` resolve `@cobuild/review-gpt` to `0.5.35`.
- The installed local `cobuild-review-gpt` binary in Murph resolves to `0.5.35`.
- Required Murph verification runs, or any pre-existing unrelated blocker is documented precisely.

## Scope

- In scope:
  - Murph root dependency metadata and lockfile updates for `@cobuild/review-gpt`.
  - The version-scoped `minimumReleaseAgeExclude` pin required for the just-published release.
  - Minimal plan and ledger bookkeeping for this rollout.
- Out of scope:
  - Any changes to Murph wrapper scripts or workflow behavior.
  - Applying or landing returned Pro patches.
  - Unrelated dirty-tree edits already present in Murph.

## Constraints

- Preserve unrelated dirty-tree edits already present in Murph.
- Use the published npm package rather than a repo-local override.
- Keep the diff scoped to the dependency rollout plus required bookkeeping.

## Tasks

1. Add the version-scoped `minimumReleaseAgeExclude` entry for `@cobuild/review-gpt@0.5.35`.
2. Update Murph's dependency metadata and lockfile to `0.5.35` with `corepack pnpm`.
3. Verify the installed CLI resolves to `0.5.35`.
4. Run Murph's required verification, then close the plan and commit the scoped change.

## Decisions

- Reuse the existing narrow dependency-rollout shape from the earlier `0.5.34` bump.
- Keep the downstream change limited to metadata and lockfile updates; the watcher behavior change lives upstream in `review-gpt`.

## Verification

- Commands to run:
  - `corepack pnpm up -D @cobuild/review-gpt@0.5.35`
  - `corepack pnpm exec cobuild-review-gpt --version`
  - `corepack pnpm typecheck`
  - `corepack pnpm test`
  - `corepack pnpm test:coverage`

## Current state

- `corepack pnpm up -D @cobuild/review-gpt@0.5.35` updated Murph to the published release after the version-scoped `minimumReleaseAgeExclude` pin moved to `@cobuild/review-gpt@0.5.35`.
- `corepack pnpm exec cobuild-review-gpt --version` returned `0.5.35`.
- `corepack pnpm typecheck` passed.
- `corepack pnpm test` is still red for pre-existing dirty-tree failures unrelated to this dependency bump:
  - `apps/cloudflare/test/workers/runtime.test.ts` still fails because `HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_JWK` is required and expected worker response codes no longer match current hosted runtime behavior.
  - `apps/web/test/device-sync-settings-routes.test.ts` still expects the older calm headline text (`Connected and syncing normally`) while the current runtime returns `Connected`.
  - the follow-on `apps/web` verify lane still exits non-zero after the hosted-web retry because the current build/smoke path is already unstable in this dirty tree.
- `corepack pnpm test:coverage` is still red for the same pre-existing `apps/cloudflare/test/workers/runtime.test.ts` and `apps/web/test/device-sync-settings-routes.test.ts` failures, plus the existing hosted-execution coverage threshold misses in `packages/hosted-execution/src/client.ts` and `packages/hosted-execution/src/env.ts`.
Completed: 2026-04-05
