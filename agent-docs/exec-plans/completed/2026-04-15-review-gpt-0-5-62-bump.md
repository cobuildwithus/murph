# Bump review-gpt to 0.5.62

Status: completed
Created: 2026-04-15
Updated: 2026-04-15

## Goal

- Update Murph to the published `@cobuild/review-gpt@0.5.62` release that fixes final-turn wake downloads.
- Keep `minimumReleaseAge` intact while reducing the `review-gpt` exceptions to only the current hotfix version.

## Success criteria

- Root `package.json`, `pnpm-workspace.yaml`, and `pnpm-lock.yaml` resolve `@cobuild/review-gpt` to `0.5.62`.
- `pnpm-workspace.yaml` exempts only `@cobuild/review-gpt@0.5.62` for this dependency instead of carrying older version exceptions.
- The installed local `cobuild-review-gpt` binary resolves to `0.5.62`.
- Required Murph verification passes, or any unrelated blocker is documented concretely.

## Scope

- In scope:
  - Murph root dependency metadata and lockfile updates for `@cobuild/review-gpt`.
  - Collapsing the `review-gpt` `minimumReleaseAgeExclude` list to the single latest hotfix entry.
  - Minimal active-plan and coordination-ledger bookkeeping for this rollout.
  - Direct local proof that the installed CLI resolves to `0.5.62`.
- Out of scope:
  - Editing Murph wrapper scripts or wake logic.
  - Applying or landing returned Pro patches.
  - Changing unrelated dirty-tree work already present in Murph.

## Constraints

- Preserve unrelated dirty-tree edits already present in Murph.
- Use the published npm package rather than a repo-local patch or file dependency.
- Keep the diff scoped to the dependency rollout plus required bookkeeping.

## Tasks

1. Update the active plan/ledger and confirm the current root `review-gpt` pin plus age-gate state.
2. Patch Murph's dependency metadata so only `@cobuild/review-gpt@0.5.62` is exempted from `minimumReleaseAge`.
3. Refresh the lockfile/install state, verify the installed CLI resolves to `0.5.62`, and run the required dependency and workspace checks.
4. Run the required final review, then close the plan and commit the scoped change.

## Decisions

- Treat this as an upstream tool rollout only.
- Keep the supply-chain exception version-scoped and single-entry instead of accumulating historical `review-gpt` exemptions.

## Verification

- Commands to run:
  - `corepack pnpm up -D @cobuild/review-gpt@0.5.62`
  - `corepack pnpm exec cobuild-review-gpt --version`
  - `corepack pnpm deps:guard`
  - `corepack pnpm deps:ignored-builds`
  - `corepack pnpm typecheck`
  - `corepack pnpm test`

## Current state

- Root `package.json` now pins `@cobuild/review-gpt` to `^0.5.62`.
- `pnpm-workspace.yaml` now keeps only `@cobuild/review-gpt@0.5.62` in `minimumReleaseAgeExclude` for this package.
- `pnpm-lock.yaml` now resolves `@cobuild/review-gpt@0.5.62`.
- `corepack pnpm exec cobuild-review-gpt --version` returned `0.5.62`.
- `corepack pnpm deps:guard`, `corepack pnpm deps:ignored-builds`, `corepack pnpm typecheck`, and `corepack pnpm test` all passed.
- Required final review completed with no findings; the only noted residual risk was broader-but-benign lockfile peer snapshot churn from the upstream dependency graph refresh.
Completed: 2026-04-15
