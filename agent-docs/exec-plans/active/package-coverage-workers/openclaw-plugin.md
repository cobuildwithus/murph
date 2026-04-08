Package owner: `@murphai/openclaw-plugin`
Path: `packages/openclaw-plugin`
Current shape: about 1 source file, 1 test

Task

Get `@murphai/openclaw-plugin` ready for package-wide root coverage with the smallest clean package-local diff possible.

Your ownership

- You own `packages/openclaw-plugin/**`.
- You may add package-local shared test helpers under `packages/openclaw-plugin/test/**` if truly needed.
- Do not edit root `vitest.config.ts`, `config/**`, or other packages. Report root-integration needs in your final message.
- Preserve unrelated worktree edits.

Workflow

1. Read the package config, source file, and existing test.
2. Compare against repo coverage-enabled patterns.
3. Publish a concise plan in commentary.
4. Add package-local coverage config if needed.
5. Spawn a GPT-5.4 high subagent if useful; for this tiny package, one subagent may own the full implementation.
6. Fill any remaining gaps without overbuilding harnesses.
7. Run package-local verification and report root integration guidance.

Requirements

- Keep the diff tiny and direct.
- Do not commit.
