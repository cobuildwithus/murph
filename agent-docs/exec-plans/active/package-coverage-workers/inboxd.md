Package owner: `@murphai/inboxd`
Path: `packages/inboxd`
Current shape: about 28 source files, 10 tests

Task

Expand package-local coverage readiness for `@murphai/inboxd` so the root repo coverage lane can include this package with package-wide patterns rather than curated file lists.

Your ownership

- You own `packages/inboxd/**`.
- You may add package-local shared test helpers under `packages/inboxd/test/**`.
- Do not edit root `vitest.config.ts`, `config/**`, or other packages. Report root-integration needs in your final message.
- The parent rollout lane already owns `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`, `agent-docs/exec-plans/active/2026-04-08-package-coverage-rollout.md`, and the worker prompt files. Read them for context only; do not edit them from this worker.
- Preserve unrelated worktree edits.
- If `pnpm` commands fail with `ERR_PNPM_VERIFY_DEPS_BEFORE_RUN`, rerun them with `--config.verify-deps-before-run=false`. Do not run `pnpm install`.

Workflow

1. Read the package config, tests, and source seams.
2. Compare the package against repo coverage-enabled patterns.
3. Start with a thorough plan in commentary:
   - package-local coverage config proposal
   - biggest untested seams
   - shared harness/helper opportunities
   - GPT-5.4 medium subagent split
4. Add package-local coverage config if needed.
5. Treat the package as standalone-coverage-ready already and spawn GPT-5.4 medium subagents for disjoint seams needed to push toward roughly 80% package-wide coverage, such as:
   - connectors and normalization flows
   - kernel/indexing/runtime paths
   - parser/shared-runtime/contracts helpers
6. Integrate changes with shared package-local helpers rather than duplicated connector scaffolding.
7. Run package-local verification and report package-specific root integration guidance.

Requirements

- Reuse connector or kernel helpers where possible.
- Keep tests deterministic and local.
- Do not commit.
