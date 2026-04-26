# Adopt configurable review-gpt snapshot attachment name

Status: completed
Created: 2026-04-26
Updated: 2026-04-26

## Goal

- Make Murph's normal `review:gpt` audit bundle use a distinct snapshot attachment filename now that `@cobuild/review-gpt` supports `snapshot_attachment_name`.

## Success criteria

- Murph depends on the published `@cobuild/review-gpt` release that contains the configurable snapshot attachment name.
- `scripts/review-gpt.config.sh` sets a review-specific snapshot ZIP filename while research workflow prompts keep their existing `repo.snapshot.zip` contract.
- Dependency policy remains version-scoped for the same-day hotfix release.
- Focused tooling tests and a direct `review:gpt --dry-run` prove the new filename is staged.

## Scope

- In scope:
  - Root `@cobuild/review-gpt` dependency and lockfile update.
  - Version-scoped pnpm `minimumReleaseAgeExclude` entry for the just-published hotfix.
  - Normal review-gpt config and directly coupled release-script coverage test.
- Out of scope:
  - Research workspace snapshot naming.
  - Browser profile routing, preset semantics, or package-audit manifest contents.

## Constraints

- Technical constraints:
  - Preserve unrelated dirty work and the existing active browser-profile tooling lane.
  - Do not make package-wide maturity exceptions.
- Product/process constraints:
  - Keep research prompts that explicitly refer to `repo.snapshot.zip` unchanged.

## Risks and mitigations

1. Risk: The new package was published minutes ago and is blocked by pnpm release-age policy.
   Mitigation: Add only `@cobuild/review-gpt@0.5.82` to `minimumReleaseAgeExclude`.
2. Risk: The normal audit bundle could drift away from tests.
   Mitigation: Extend the existing release-script coverage test and run a dry-run staging check.

## Tasks

1. Update Murph dependency metadata to `@cobuild/review-gpt` `0.5.82`.
2. Configure the normal review-gpt snapshot attachment name.
3. Update focused test coverage for the config contract.
4. Run focused verification and complete the scoped commit flow.

## Decisions

- Use `murph-review-gpt.repo-snapshot.zip` for normal audit/review sends so it is visually distinct from research workflow snapshots.

## Verification

- Completed:
  - `pnpm install --frozen-lockfile`
  - `pnpm deps:approve-builds` with `CI=1`
  - `pnpm deps:guard`
  - `pnpm exec cobuild-review-gpt --version`
  - `pnpm exec vitest run --config vitest.config.ts --no-coverage packages/cli/test/release-script-coverage-audit.test.ts`
  - `pnpm review:gpt --dry-run`
  - `bash -n scripts/review-gpt.config.sh`
  - `git diff --check -- package.json pnpm-lock.yaml pnpm-workspace.yaml scripts/review-gpt.config.sh packages/cli/test/release-script-coverage-audit.test.ts agent-docs/exec-plans/active/2026-04-26-review-gpt-snapshot-attachment-name.md`
- Outcomes:
  - `cobuild-review-gpt` reports `0.5.82`.
  - Focused release-script coverage tests pass.
  - Dry run reports `ZIP file: audit-packages/murph-review-gpt.repo-snapshot.zip`.
  - `pnpm deps:approve-builds` reports no packages awaiting approval.
  - `pnpm deps:ignored-builds` exits 0 but reports it cannot identify because no node_modules was found, even though this checkout has a root `node_modules/.modules.yaml`; no approval-list change was made.
  - `pnpm typecheck` remains blocked by unrelated active protocol/regimen and workspace-boundary work outside this plan.
Completed: 2026-04-26
