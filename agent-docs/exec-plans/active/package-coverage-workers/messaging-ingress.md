Package owner: `@murphai/messaging-ingress`
Path: `packages/messaging-ingress`
Current shape: about 5 source files, 3 tests

Task

Get `@murphai/messaging-ingress` ready for package-wide root coverage with clean package-local coverage config and any small missing tests.

Your ownership

- You own `packages/messaging-ingress/**`.
- You may add package-local shared test helpers under `packages/messaging-ingress/test/**`.
- Do not edit root `vitest.config.ts`, `config/**`, or other packages. Report root-integration needs in your final message.
- Preserve unrelated worktree edits.

Workflow

1. Read the package config, tests, and small source surface.
2. Compare it with repo coverage-enabled patterns.
3. Publish a concise but thorough plan in commentary.
4. Add package-local coverage config if needed.
5. Spawn GPT-5.4 high subagents if that produces a clean split; otherwise one subagent may own the full package.
6. Close the remaining test gaps with simple deterministic tests.
7. Run package-local verification and report root integration guidance.

Requirements

- Keep helper setup minimal.
- Favor simple pure tests over elaborate harnesses.
- Do not commit.
