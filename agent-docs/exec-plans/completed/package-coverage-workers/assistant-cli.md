Package owner: `@murphai/assistant-cli`
Path: `packages/assistant-cli`
Current shape: CLI/runtime/UI package with existing tests but major package-wide coverage gaps

Task

Raise `@murphai/assistant-cli` to honest package-wide coverage. Do not use curated coverage include lists; the package must keep package-wide `coverage.include: ["src/**/*.ts"]` and gain enough real tests to satisfy the shared thresholds.

Your ownership

- You own `packages/assistant-cli/**`.
- You may add package-local shared test helpers under `packages/assistant-cli/test/**` when that reduces duplication.
- Do not edit root `vitest.config.ts`, `config/**`, or other packages. Report any root integration needs in your final message instead.
- Preserve unrelated dirty worktree edits.
- Do not commit.

Workflow

1. Read the package config, current tests, and the package-wide coverage failures from `pnpm --dir packages/assistant-cli test:coverage`.
2. Compare the package against existing coverage-enabled packages with reusable helper patterns.
3. Start with a thorough plan in commentary:
   - largest failing seams
   - current helper reuse opportunities
   - minimal package-local helper additions
   - required GPT-5.4 `medium` subagent split
4. Spawn GPT-5.4 `medium` subagents. This is required, not optional. Use disjoint ownership such as:
   - `src/assistant/**` runtime/service/doctor/stop/status seams
   - `src/assistant/ui/**` controller/composer/theme/view-model seams
   - `src/commands/assistant.ts`, `src/run-terminal-logging.ts`, and related top-level runtime seams
5. Integrate the subagent changes, keeping tests behavior-oriented and deterministic.
6. Keep package-wide `coverage.include: ["src/**/*.ts"]`. Do not switch back to curated include lists.
7. Run package-local verification and report the exact package-wide result.

Requirements

- Reuse the existing UI/runtime helper tests before inventing a second harness stack.
- Favor a few shared package-local helpers over many copy-pasted stubs.
- Keep API and runtime behavior unchanged.
- If `pnpm` commands hit `ERR_PNPM_VERIFY_DEPS_BEFORE_RUN`, stop and report the workspace-state blocker. Do not bypass the guard.
