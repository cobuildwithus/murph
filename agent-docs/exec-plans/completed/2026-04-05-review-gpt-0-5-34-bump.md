# Bump review-gpt to 0.5.34

Status: completed
Created: 2026-04-05
Updated: 2026-04-05

## Goal

- Update Murph to the published `@cobuild/review-gpt@0.5.34` release.
- Keep the downstream change scoped to the root dependency metadata, lockfile, and required bookkeeping only.

## Success criteria

- Root `package.json`, `pnpm-lock.yaml`, and any required dependency policy pins resolve `@cobuild/review-gpt` to `0.5.34`.
- The installed local `cobuild-review-gpt` binary resolves to the new version.
- Required Murph verification passes, or any unrelated blocker is documented concretely.

## Scope

- In scope:
  - Murph root dependency metadata and lockfile updates for `@cobuild/review-gpt`.
  - Minimal active-plan and coordination-ledger bookkeeping for this rollout.
  - Direct local proof that the installed CLI resolves to `0.5.34`.
- Out of scope:
  - Applying or landing any returned Pro patches.
  - Editing unrelated dirty-tree changes already present in Murph.
  - Changing Murph wrapper scripts or workflow behavior.

## Constraints

- Preserve unrelated dirty-tree edits already present in Murph.
- Use the published npm package rather than a repo-local patch or file dependency.
- Keep the diff scoped to the dependency rollout plus required bookkeeping.

## Tasks

1. Confirm `@cobuild/review-gpt@0.5.34` is published and record the narrow rollout plan in the ledger.
2. Update Murph's dependency metadata and lockfile to the published version without widening the diff.
3. Verify the installed CLI resolves to `0.5.34`.
4. Run Murph's required verification, then close the plan and commit the scoped change.

## Decisions

- Treat this as an upstream tool rollout only.
- Avoid the upstream repo's cross-repo auto-sync and update Murph directly.

## Verification

- Commands to run:
  - `npm view @cobuild/review-gpt version`
  - `corepack pnpm up -D @cobuild/review-gpt@^0.5.34`
  - `corepack pnpm exec cobuild-review-gpt --version`
  - `corepack pnpm typecheck`
  - `corepack pnpm test`
  - `corepack pnpm test:coverage`

## Current state

- `npm view @cobuild/review-gpt version` returned `0.5.34`.
- `corepack pnpm up -D @cobuild/review-gpt@0.5.34` updated Murph to the published release after the required version-scoped `minimumReleaseAgeExclude` pin moved from `0.5.33` to `0.5.34`.
- `corepack pnpm exec cobuild-review-gpt --version` returned `0.5.34`.
- `corepack pnpm deps:ignored-builds` still reports the existing blocked install-script set (`msw`, `sharp`, `workerd`, `bufferutil`, `utf-8-validate`, `unrs-resolver`, `better-sqlite3`, `@reown/appkit`, `keccak`) with no new review-gpt-specific build approval needed.
- `corepack pnpm typecheck` fails in already-dirty hosted-runtime work at `packages/hosted-execution/src/web-control-plane.ts` because missing `HostedExecutionSharePackResponse` / `parseHostedExecutionSharePackResponse` / `buildHostedExecutionSharePayloadPath` exports and the removed `sharePack` scope leave the workspace build red before this dependency bump can matter.
- `corepack pnpm test` is red for the same pre-existing `packages/hosted-execution/src/web-control-plane.ts` export breakage, plus existing dirty assistant-runtime package-resolution failures around `@murphai/query` and follow-on CLI tests that fail because `pnpm build:test-runtime:prepared` is already broken.
- `corepack pnpm test:coverage` is red for the same pre-existing hosted-execution and assistant-runtime dirty-tree failures.
Completed: 2026-04-05
