Package owner: `@murphai/setup-cli`
Path: `packages/setup-cli`
Current shape: large setup wizard/services package with broad package-wide gaps across assistant setup, wizard flow, codex-home, and setup-services seams

Task

Raise `@murphai/setup-cli` to honest package-wide coverage with package-wide `coverage.include: ["src/**/*.ts"]`. Do not use curated include lists.

Your ownership

- You own `packages/setup-cli/**`.
- You may add package-local shared helpers under `packages/setup-cli/test/**`.
- Do not edit root/shared coverage config or other packages.
- Preserve unrelated dirty worktree edits.
- Do not commit.

Workflow

1. Read the package config, current tests, and current package-wide coverage failure output.
2. Start with a thorough plan in commentary:
   - failing files and highest-value branches
   - helper reuse opportunities
   - required GPT-5.4 `medium` subagent split
3. Spawn GPT-5.4 `medium` subagents. This is required. Prefer disjoint ownership such as:
   - `src/setup-assistant*.ts` and `src/setup-agentmail.ts`
   - `src/setup-cli.ts`, `src/setup-wizard*.ts`, and `src/setup-wizard-ui.ts`
   - `src/setup-services*.ts`, `src/setup-codex-home.ts`, and `src/incur-error-bridge.ts`
4. Integrate the changes, reusing existing wizard/setup-service helpers before adding new shared ones.
5. Keep package-wide `coverage.include: ["src/**/*.ts"]`.
6. Run package-local verification and report the final package-wide result.

Requirements

- Prefer behavior-focused wizard and service tests over brittle snapshot-style assertions.
- Keep helper growth disciplined and package-local.
