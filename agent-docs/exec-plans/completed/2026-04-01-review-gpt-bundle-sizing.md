# Reduce review:gpt default bundle size

Status: completed
Created: 2026-04-01
Updated: 2026-04-01

## Goal

- Make `pnpm review:gpt` stage a meaningfully smaller default upload so draft preparation and ChatGPT attachment upload complete faster without removing the ability to request the previous broad repo bundle when needed.

## Success criteria

- `pnpm review:gpt --dry-run` produces a smaller file count and artifact sizes than the current default while still including the core repo and workflow context.
- The repo keeps an explicit full-context `review:gpt` entrypoint for audits that really do need tests, broad docs, and CI files.
- Docs and script coverage reflect the new default versus full-bundle behavior.
- Lean default preserves durable `agent-docs` context while excluding generated agent-docs, completed plan history, prompt boilerplate, tests, CI, and the broad `docs/**` set beyond `docs/architecture.md`.

## Scope

- In scope:
  - repo-local `review:gpt` and audit-package wrapper/config defaults
  - explicit full-context wrapper/config for the prior broad bundle shape
  - README and focused script coverage updates
- Out of scope:
  - upstream `@cobuild/review-gpt` behavior changes
  - changing ChatGPT browser automation or attachment ordering
  - changing the separate `review:gpt:data` vault-bundle flow

## Constraints

- Technical constraints:
  - preserve the current `cobuild-review-gpt` CLI contract and preset registration flow
  - do not remove the repo snapshot ZIP or repomix XML artifacts entirely
  - preserve unrelated dirty-tree edits
- Product/process constraints:
  - the default bundle still needs enough repo/workflow context for a useful audit
  - repo code changes require the standard verification and final audit flow

## Risks and mitigations

1. Risk: trimming the bundle too aggressively could make default audits less useful.
   Mitigation: keep the core repo/workflow docs in the always-included set and add an explicit `review:gpt:full` path for broad audits.
2. Risk: shell-config changes drift from documented or tested script surfaces.
   Mitigation: update README usage and focused script coverage assertions in the same change.

## Tasks

1. Measure the current default bundle and identify the highest-signal size reductions.
2. Tighten the default audit-context include set and add an explicit full-bundle wrapper.
3. Update the maintainer docs and focused script coverage.
4. Re-run dry-runs and required repo verification, then complete the final audit pass.

## Decisions

- Current `review:gpt` includes tests because the package wrapper defaults tests on unless repo-tools env defaults override it; `include_tests=0` in `scripts/review-gpt.config.sh` is not sufficient by itself.
- The raw repomix XML is the dominant upload cost; the snapshot ZIP is already relatively small.
- Default lean bundle now keeps normal repo source plus durable `agent-docs` context, while excluding generated agent-docs, completed plan history, prompt boilerplate, tests, CI, and the broader `docs/**` set beyond `docs/architecture.md`.
- A separate full-context entrypoint preserves the previous broad path.

## Verification

- Commands to run:
  - `pnpm review:gpt --dry-run`
  - `pnpm review:gpt:full --dry-run`
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
- Expected outcomes:
  - dry-runs report smaller default bundle sizes and keep the full-context path working
  - required repo checks pass, or any unrelated failures are documented

## Outcome

- Landed repo-local lean/full wrapper split:
  - `pnpm review:gpt` keeps repo source plus durable `agent-docs`
  - `pnpm review:gpt:full` keeps the previous broad bundle shape
- Added focused package-behavior coverage that inspects lean/full ZIP contents directly.

## Verification results

- Passed: `pnpm exec vitest run packages/cli/test/release-script-coverage-audit.test.ts --config vitest.config.ts --no-coverage`
- Passed: `pnpm review:gpt --dry-run`
  - lean bundle: 977 files, `repo.snapshot.zip` 1,768,529 bytes, `repo.repomix.xml` 6,583,048 bytes
- Passed: `pnpm review:gpt:full --dry-run`
  - full bundle: 2020 files, `repo.snapshot.zip` 3,568,739 bytes, `repo.repomix.xml` 12,825,174 bytes
- Failed for unrelated pre-existing reason: `pnpm typecheck`
  - current failure is a pre-existing import without typings at `packages/cli/test/release-script-coverage-audit.test.ts:11` for `../../../scripts/check-workspace-package-cycles.mjs`
- Failed for unrelated pre-existing dirty-tree reason: `pnpm test`
  - current failure is the repo doc-drift guard reporting unrelated dirty `agent-docs` edits outside this task (`agent-docs/generated/doc-inventory.md`, `agent-docs/operations/verification-and-runtime.md`, `agent-docs/references/testing-ci-map.md`)
- Previously failed for unrelated pre-existing reason: `pnpm test:coverage`
  - failing tests were unrelated CLI env-selection cases:
    - `packages/cli/test/setup-cli.test.ts > murph loads VAULT from a local .env file`
    - `packages/cli/test/cli-test-helpers.test.ts > cli test helpers reset env-backed vault selection across persistent harness commands`
Completed: 2026-04-01
