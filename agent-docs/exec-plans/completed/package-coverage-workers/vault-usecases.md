Package owner: `@murphai/vault-usecases`
Path: `packages/vault-usecases`
Current shape: package with no package-local tests, no package-local coverage command, and active overlapping source edits from another lane

Task

Bring `@murphai/vault-usecases` onto an honest initial package-local test and coverage path in the shared current worktree. Prefer package-local tests, package-local Vitest config, and package manifest wiring only. Do not invent fake coverage, and do not trample the active overlapping source lane.

Your ownership

- You own package-local test and coverage wiring for `packages/vault-usecases/**`.
- Prefer new files under `packages/vault-usecases/test/**`, plus `package.json` and a package-local `vitest.config.ts`.
- Read current file state first because `packages/vault-usecases/package.json` and some source files already have adjacent dirty edits from another lane.
- You are not alone in the codebase. Preserve unrelated dirty edits and do not revert others' work.
- Do not edit root/shared coverage config or other packages.
- Do not commit.

Workflow

1. Read the current package manifest, current source entrypoints, and the active ledger context.
2. Keep the initial scope narrow:
   - add package-local tests for stable entrypoints/helpers only
   - add package-local coverage wiring only if the package can support an honest command today
   - avoid source edits unless package-local tests prove a tiny behavior-preserving seam is strictly required
3. Prefer coverage on public seams such as:
   - `src/index.ts`
   - `src/helpers.ts`
   - `src/json-input.ts`
   - `src/option-utils.ts`
   - `src/health-cli-{descriptors,method-types}.ts`
   - `src/vault-services.ts`
4. If the package is too broad to make green honestly in one pass, still land the smallest truthful package-local test/coverage setup and report the resulting coverage posture precisely.
5. Run package-local verification and report exact commands/results.

Requirements

- Keep the diff narrow and package-local.
- Do not weaken repo coverage rules or invent package-specific excuses.
- If the overlapping dirty source lane makes a source edit unsafe, stay test/config-only and call that out explicitly.
