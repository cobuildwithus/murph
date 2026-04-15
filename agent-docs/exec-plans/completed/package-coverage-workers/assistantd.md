Package owner: `@murphai/assistantd`
Path: `packages/assistantd`
Current shape: about 6 source files, 5 tests

Task

Get `@murphai/assistantd` ready for package-wide root coverage with minimal, clean package-local changes.

Your ownership

- You own `packages/assistantd/**`.
- You may add package-local shared test helpers under `packages/assistantd/test/**`.
- Do not edit root `vitest.config.ts`, `config/**`, or other packages. Report root-integration needs in your final message.
- Preserve unrelated worktree edits.

Workflow

1. Read the package config, tests, and source files.
2. Compare the package against repo coverage-enabled Vitest config patterns.
3. Publish a short but thorough plan in commentary.
4. Add package-local coverage config if needed.
5. Spawn GPT-5.4 high subagents for disjoint seams if helpful; one subagent may own the whole package if that is cleaner for this small surface.
6. Fill the remaining gaps with behavior-focused tests.
7. Run package-local verification and report the root include/exclude guidance for this package.

Requirements

- Keep this package small and tidy. Do not over-engineer helpers.
- Reuse existing HTTP/service test helpers when possible.
- Do not commit.
