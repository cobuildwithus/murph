# Vault CLI Batch Command

## Goal

Add a generic, agent-safe `vault-cli batch` primitive that runs multiple CLI argv arrays in one Node process, reducing repeated process startup cost for agent read bursts.

Success criteria:

- `vault-cli batch` accepts repeated JSON argv arrays and returns structured per-command results.
- Child commands reuse the current vault and JSON output by default.
- The assistant onboarding prompt prefers the batch command for resume checks.
- Focused runtime tests, generated CLI artifacts, typecheck, and required verification pass.
- Timing proof shows whether the generic batch shape improves the measured container workflow.

## Constraints

- Keep the primitive simple: no daemon, scheduler, shell parser, or arbitrary shell-string execution.
- Preserve existing individual command behavior.
- Avoid unrelated hosted runner, media catalog, and active web/orchestrator lanes.
- Do not expose local identifiers in committed docs or generated outputs.

## Plan

1. Add a narrow `batch` command using argv-array inputs.
2. Route and manifest the command for lazy CLI loading and generated schemas.
3. Update onboarding guidance to prefer `vault-cli batch` for bounded resume reads.
4. Add focused tests and regenerate CLI artifacts.
5. Measure end-to-end container timing and run completion verification/audits.

## Verification

- Prototype timing in disposable `linux/amd64` Node container:
  - `node -e ""`: 215ms.
  - One fresh Node process running eight CLI argv arrays in-process: 1839ms.
  - Eight separate commands sequentially: 8715ms.
  - Eight separate commands launched in parallel: 2357ms.
- Built `vault-cli batch` timing in disposable `linux/amd64` Node container:
  - `node -e ""`: 228ms.
  - `vault-cli batch` for eight reads: 1794ms.
  - Eight separate commands sequentially: 9363ms.
  - Eight separate commands launched in parallel: 3080ms.
- Focused tests passed:
  - `pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage packages/cli/test/batch.test.ts packages/cli/test/vault-cli-command-routing.test.ts` (35 tests after edge-case additions).
  - `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-skill-assets.test.ts`.
- Package checks passed:
  - `pnpm --dir packages/cli typecheck`.
  - `pnpm --dir packages/assistant-engine typecheck`.
  - `pnpm --dir packages/cli verify:package-shape`.
  - `pnpm --dir packages/cli gen:config-schema`.
  - `git diff --check`.
  - `pnpm typecheck`.
  - `bash scripts/workspace-verify.sh test:diff packages/cli/src/commands/batch.ts packages/cli/src/cli-entry.ts packages/cli/src/vault-cli-command-manifest.ts packages/cli/src/vault-cli-command-routing.ts packages/cli/src/vault-cli-routing.ts packages/cli/test/batch.test.ts packages/cli/test/vault-cli-command-routing.test.ts packages/cli/config.schema.json packages/cli/src/incur.generated.ts packages/assistant-engine/skills/murph-onboarding/SKILL.md packages/assistant-engine/test/assistant-skill-assets.test.ts`.
- Completion audits:
  - `coverage-write`: accepted finding to add executed-child failure coverage; fixed in `packages/cli/test/batch.test.ts`.
  - `deep-review`: accepted finding that generic batch must not enter setup or interactive/long-running assistant loops; fixed by blocking `onboard`, `chat`, `assistant chat`, and long-running `run` / `assistant run` without `--once`.
  - `prompt-review`: no findings after rerun in the task worktree.
  - `security-privacy-review`: no medium-or-higher findings after rerun in the task worktree; residual risk is that `batch` is a local CLI authority surface and must not be exposed to untrusted remote callers without a separate allowlist/output policy.
Status: completed
Updated: 2026-06-16
Completed: 2026-06-16
