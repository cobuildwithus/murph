# Release Action Pinning

Status: completed
Updated: 2026-05-06
Completed: 2026-05-06

## Goal

Pin mutable GitHub Action refs in the npm release workflow so the publish path does not trust moving action tags.

## Success criteria

- `.github/workflows/release.yml` uses full commit SHAs for action refs.
- The existing release workflow guard test rejects mutable action refs.
- Focused verification passes.

## Scope

- In scope: `.github/workflows/release.yml`, `packages/cli/test/release-workflow-guards.test.ts`.
- Out of scope: changing release semantics, package publish logic, npm trusted publishing configuration, or release permissions.

## Constraints

- Keep the rule simple and workflow-wide: all `uses:` refs are SHA-pinned.
- Preserve unrelated dirty work.
- Do not expose local identifiers, secrets, or credentials.

## Tasks

1. Register active work. Done.
2. Pin release workflow action refs. Done.
3. Add/extend guard test for immutable refs. Done.
4. Run focused verification and typecheck. Done.
5. Commit scoped changes if safe. Done.

## Decisions

- Pin every action ref in `release.yml`, not only the publish job, so the workflow has one clear invariant.
- Keep the previous semantic tag as a comment after each SHA for maintainability.
- Do not change release permissions or npm trusted publishing behavior in this patch.

## Verification

- `pnpm --dir packages/cli exec vitest run test/release-workflow-guards.test.ts` passed.
- `pnpm --dir packages/cli typecheck` passed.
- `ruby -e 'require "yaml"; YAML.load_file(".github/workflows/release.yml")'` passed.
- `git diff --check -- .github/workflows/release.yml packages/cli/test/release-workflow-guards.test.ts agent-docs/exec-plans/active/2026-05-06-release-action-pinning.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md` passed.
- `pnpm typecheck` was attempted and failed from unrelated dirty/generated workspace state outside this change.
