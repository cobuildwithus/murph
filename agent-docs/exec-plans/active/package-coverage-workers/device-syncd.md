Package owner: `@murphai/device-syncd`
Path: `packages/device-syncd`
Current shape: about 22 source files, 16 tests

Task

Expand package-local coverage readiness for `@murphai/device-syncd` so the root repo coverage lane can include this package with package-wide patterns rather than curated file lists.

Your ownership

- You own `packages/device-syncd/**`.
- You may add package-local shared test helpers under `packages/device-syncd/test/**`.
- Do not edit root `vitest.config.ts`, `config/**`, or other packages. Report root-integration needs in your final message.
- The parent rollout lane already owns `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`, `agent-docs/exec-plans/active/2026-04-08-package-coverage-rollout.md`, and the worker prompt files. Read them for context only; do not edit them from this worker.
- Preserve unrelated worktree edits.
- If `pnpm` commands fail with `ERR_PNPM_VERIFY_DEPS_BEFORE_RUN`, stop and report the workspace-state blocker. Do not bypass the guard or run `pnpm install`.

Workflow

1. Read the package config, tests, and source seams.
2. Compare the package against repo coverage-enabled patterns.
3. Start with a thorough plan in commentary.
4. Add package-local coverage config if needed.
5. Treat the package as standalone-coverage-ready already and spawn GPT-5.4 medium subagents for disjoint seams needed to push toward roughly 80% package-wide coverage, such as:
   - control-plane HTTP/config/public-ingress behavior
   - provider implementations and webhook verification
   - store/shared/hosted-runtime or crypto helpers
6. Integrate, favor existing provider/service helpers, and avoid duplicate setup.
7. Run package-local verification and report package-specific root integration guidance.

Requirements

- Prefer shared provider or HTTP helper reuse.
- Keep changes local to this package.
- Do not commit.
