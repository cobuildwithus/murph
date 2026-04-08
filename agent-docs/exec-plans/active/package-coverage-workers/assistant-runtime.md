Package owner: `@murphai/assistant-runtime`
Path: `packages/assistant-runtime`
Current shape: about 25 source files, 9 tests

Task

Expand package-local coverage readiness for `@murphai/assistant-runtime` so the root repo coverage lane can include this package with package-wide patterns rather than curated file lists.

Your ownership

- You own `packages/assistant-runtime/**`.
- You may add package-local shared test helpers under `packages/assistant-runtime/test/**`.
- Do not edit root `vitest.config.ts`, `config/**`, or other packages. Report root-integration needs in your final message.
- Preserve unrelated worktree edits.

Workflow

1. Read the package config, current tests, and hosted-runtime source seams.
2. Compare existing package coverage config patterns used elsewhere in the repo.
3. Write a thorough plan in commentary before editing:
   - package-local coverage config proposal
   - missing test seams
   - shared harness/helper opportunities
   - GPT-5.4 high subagent split
4. Add package-local coverage config if needed.
5. Spawn GPT-5.4 high subagents for disjoint seams such as:
   - hosted runtime event handlers and callbacks
   - platform/environment/artifact or usage helpers
   - hosted email and device-sync runtime helpers
6. Integrate the changes and keep tests focused on behavior and boundary handling.
7. Run package-local verification and report package-local root-integration recommendations.

Requirements

- Prefer shared hosted-runtime test helpers over per-test bespoke setup.
- Keep changes inside this package.
- Do not commit.
