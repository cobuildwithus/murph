Package owner: `@murphai/operator-config`
Path: `packages/operator-config`
Current shape: broad config/runtime helper package with the largest remaining package-wide coverage gap in this six-package batch

Task

Raise `@murphai/operator-config` to honest package-wide coverage. The package must keep package-wide `coverage.include: ["src/**/*.ts"]`; do not use curated include lists.

Your ownership

- You own `packages/operator-config/**`.
- You may add package-local shared helpers under `packages/operator-config/test/**`.
- Do not edit root/shared coverage config or other packages.
- Preserve unrelated dirty worktree edits in this package, including adjacent in-flight work.
- Do not commit.

Workflow

1. Read the package config, tests, and current package-wide coverage failure output.
2. Publish a thorough package plan in commentary:
   - highest-value failing seams
   - shared helper opportunities
   - required GPT-5.4 `medium` subagent split
3. Spawn GPT-5.4 `medium` subagents. This is required. Prefer disjoint seams such as:
   - `src/assistant/**` config/redaction/provider/state helper seams
   - `src/{device-sync-client,http-json-retry,http-retry,linq-runtime,telegram-runtime}.ts`
   - `src/{command-helpers,setup-runtime-env,operator-config,setup-prompt-io,text/shared}.ts` plus thin entrypoints/contracts
4. Integrate the changes while preserving package behavior and reusing shared package-local helpers aggressively.
5. Keep package-wide `coverage.include: ["src/**/*.ts"]`.
6. Run package-local verification and report the final package-wide result.

Requirements

- Prefer reusable config/runtime helper fixtures over copy-pasted env/setup stubs.
- Keep tests deterministic and avoid widening public API.
