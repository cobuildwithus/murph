Package owner: `@murphai/openclaw-plugin`
Path: `packages/openclaw-plugin`
Current shape: about 1 source file, 1 test

Task

Get `@murphai/openclaw-plugin` ready for package-wide root coverage with the smallest clean package-local diff possible.

Your ownership

- You own `packages/openclaw-plugin/**`.
- You may add package-local shared test helpers under `packages/openclaw-plugin/test/**` if truly needed.
- Do not edit root `vitest.config.ts`, `config/**`, or other packages. Report root-integration needs in your final message.
- The parent rollout lane already owns `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`, `agent-docs/exec-plans/active/2026-04-08-package-coverage-rollout.md`, and the worker prompt files. Read them for context only; do not edit them from this worker.
- Preserve unrelated worktree edits.
- If `pnpm` commands fail with `ERR_PNPM_VERIFY_DEPS_BEFORE_RUN`, rerun them with `--config.verify-deps-before-run=false`. Do not run `pnpm install`.

Workflow

1. Read the package config, source file, and existing test.
2. Compare against repo coverage-enabled patterns.
3. Publish a concise plan in commentary.
4. Add package-local coverage config if needed.
5. Treat the package as standalone-coverage-ready already and spawn a GPT-5.4 medium subagent to push the package toward roughly 80% package-wide coverage; for this tiny package, one subagent may own the full implementation.
6. Fill any remaining gaps without overbuilding harnesses.
7. Run package-local verification and report root integration guidance.

Requirements

- Keep the diff tiny and direct.
- Do not commit.
