# DeepSec Hardening

Status: completed
Created: 2026-05-10
Updated: 2026-05-10

## Goal

Fix the narrow DeepSec findings that are low-complexity and align with existing architecture: biomarker source URL safety, AgentMail setup base URL consistency, and setup subprocess secret minimization.

## Success Criteria

- Biomarker web artifact source links only emit safe HTTP(S) URLs.
- AgentMail inbox discovery honors `AGENTMAIL_BASE_URL`.
- Interactive setup does not pass prompted provider credentials to external tool-provisioning subprocesses.
- Focused tests cover each changed invariant.
- Required verification and completion audits pass, or unrelated blockers are documented.

## Scope

- In scope:
  - `packages/health-commons/src/biomarker-web-artifacts.ts`
  - Health Commons tests for unsafe biomarker source URLs.
  - `packages/setup-cli/src/setup-agentmail.ts`
  - Setup CLI tests for AgentMail base URL discovery.
  - Setup CLI service env handling and tests for subprocess secret minimization.
- Out of scope:
  - Hosted device explicit `--base-url` behavior.
  - Broad secret-detection frameworks or external installer env allowlist rewrites.
  - Generated content churn where current generated URLs are already safe.

## Constraints

- Keep changes narrow and composable.
- Preserve unrelated dirty worktree edits and active ledger rows.
- Do not expose local usernames, home paths, secrets, raw credentials, or provider keys in docs, tests, logs, or handoff.

## Tasks

1. Add biomarker source URL sanitization at the artifact boundary and focused tests.
2. Pass configured AgentMail base URL into setup discovery and update tests.
3. Scrub known setup credential keys from external provisioning command env while preserving them for Murph configuration and local env persistence.
4. Run focused verification and required completion audits.

## Verification

- PASS: `pnpm --dir packages/health-commons exec vitest run --config vitest.config.ts test/biomarker-web-artifacts.test.ts --no-coverage`
- PASS: `pnpm --dir packages/setup-cli exec vitest run --config vitest.config.ts test/setup-agentmail.test.ts test/setup-services-coverage.test.ts --no-coverage`
- PASS: `pnpm --dir packages/health-commons typecheck`
- PASS: `pnpm --dir packages/setup-cli typecheck`
- PASS: `git diff --check -- <task files>`
- PASS: `pnpm typecheck`
- FAIL (unrelated generated-index expectation): `pnpm test:diff packages/health-commons/src/biomarker-web-artifacts.ts packages/health-commons/test/biomarker-web-artifacts.test.ts packages/setup-cli/src/setup-agentmail.ts packages/setup-cli/src/setup-services.ts packages/setup-cli/test/setup-agentmail.test.ts packages/setup-cli/test/setup-services-coverage.test.ts`
  - Expanded reverse-dependent checks passed through the CLI lane.
  - The Health Commons package test then failed in `packages/health-commons/test/runtime.test.ts` on `loads the compact generated biomarker browse index`.
  - The assertion expects `sleep-quality` in the published route ids, while the current generated biomarker index contains the current route ids. This is unrelated to biomarker source URL emission or setup CLI env handling.
- PASS: `pnpm test:smoke`
- PASS: security/privacy review found no findings.
- PASS: coverage/proof worker made no changes and found the added tests sufficient for this task.
- PASS: final task-finish review found no findings.
Completed: 2026-05-10
