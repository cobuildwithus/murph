Package owner: `@murphai/murph`
Path: `packages/cli`
Current shape: about 47 source files, 67 tests

Task

Expand package-local coverage readiness for `@murphai/murph` so the root repo coverage lane can cover the package broadly with package-wide patterns instead of curated file lists.

Your ownership

- You own `packages/cli/**`.
- You may add package-local shared test helpers under `packages/cli/test/**`.
- Do not edit root `vitest.config.ts`, `config/**`, or other packages. Report root-integration needs in your final message.
- Preserve unrelated worktree edits, including current changes in nearby package tests.

Workflow

1. Read `packages/cli/vitest.config.ts`, `packages/cli/vitest.workspace.ts`, current tests, and source seams.
2. Compare current package-local test organization with repo coverage-enabled patterns.
3. Start with a thorough plan in commentary:
   - package-local coverage config proposal
   - biggest untested command/runtime seams
   - shared harness opportunities
   - GPT-5.4 high subagent split
4. Add package-local coverage config if needed, keeping the existing workspace-bucket approach intact.
5. Spawn GPT-5.4 high subagents for disjoint seams such as:
   - assistant/runtime command surfaces
   - health/read/search/export command surfaces
   - inbox/device/setup/knowledge or schema manifest surfaces
   Adjust the split to match actual gaps.
6. Integrate the changes, preferring existing CLI helper reuse over new harness duplication.
7. Run package-local verification and report package-specific root integration guidance.

Requirements

- Preserve the current split workspace project structure unless a change is clearly necessary.
- Prefer extending existing CLI test helpers instead of inventing parallel helper stacks.
- Do not commit.
