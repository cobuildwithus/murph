# Land stale-provider hard-cut residue cleanup

Status: completed
Created: 2026-04-28
Updated: 2026-04-28

## Goal

- Remove stale hard-cut residue around deleted provider tests, deleted assistant-cli-tools export references, and removed OpenAI-compatible setup/provider surfaces.

## Success criteria

- `scripts/workspace-verify.sh`, workspace-boundary guards, and root TypeScript config no longer reference deleted tests or removed assistant-cli-tools exports.
- `packages/assistantd` session-options provider validation accepts only `codex-cli`.
- `@murphai/operator-config` no longer exposes the public `./openai-compatible-provider-presets` export if internal callers can keep importing through package-local paths.
- Setup wizard UI fixture text no longer describes saved OpenAI-compatible endpoint wording.
- Focused checks and required audits complete or any blockers are documented.

## Scope

- In scope:
  - `scripts/workspace-verify.sh`
  - `packages/assistantd/src/http-protocol.ts`
  - `packages/assistantd/test/http-coverage.test.ts`
  - `tsconfig.base.json`
  - `scripts/workspace-boundaries/public-surface-rules.mjs`
  - `scripts/workspace-boundaries/package-export-rules.mjs`
  - `packages/operator-config/package.json`
  - `packages/operator-config/test/codex-hard-cut-contract.test.ts`
  - `packages/setup-cli/test/setup-wizard-ui.test.ts`
- Out of scope:
  - Assistant-runtime env files.
  - Cloudflare files.
  - CLI docs or smoke files.
  - Git commits.

## Constraints

- Technical constraints:
  - Preserve unrelated dirty work in the shared checkout.
  - Keep internal imports working when removing public package exports.
- Product/process constraints:
  - Follow AGENTS.md privacy guardrails.
  - Do not commit.

## Risks and mitigations

1. Risk: Removing a public export can break internal workspace callers.
   Mitigation: Search all call sites and keep internal imports package-local or through supported owner surfaces.
2. Risk: Concurrent hard-cut work may overlap nearby package config/tests.
   Mitigation: Restrict edits to user-owned files and inspect diffs before handoff.

## Tasks

1. Inspect stale residue and current call sites.
2. Run separable worker lanes for scripts/package exports and assistantd/setup coverage where useful.
3. Integrate edits and update hard-cut contract coverage.
4. Run focused verification plus required completion audits.
5. Close the active plan without committing.

## Decisions

- Use a plan-bearing lane because the task touches multiple repo subsystems.
- Keep `assistant-cli-tools` only in negative hard-cut boundary guards so the removed helper surface cannot be revived through assistant-engine exports or root/provider re-exports.

## Verification

- Passed:
  - `node --check scripts/workspace-boundaries/public-surface-rules.mjs && node --check scripts/workspace-boundaries/package-export-rules.mjs`
  - `bash -n scripts/workspace-verify.sh`
  - `node scripts/verify-workspace-boundaries.mjs`
  - `pnpm exec vitest run --config scripts/vitest.config.ts --no-coverage scripts/workspace-boundaries/package-export-rules.test.ts`
  - `pnpm --dir packages/assistantd exec vitest run test/http-coverage.test.ts --config vitest.config.ts --no-coverage`
  - `pnpm --dir packages/operator-config exec vitest run test/codex-hard-cut-contract.test.ts --config vitest.config.ts --no-coverage`
  - `pnpm --dir packages/setup-cli exec vitest run test/setup-wizard-ui.test.ts --config vitest.config.ts --no-coverage`
  - `pnpm --dir packages/assistantd test:coverage`
  - `pnpm --dir packages/operator-config test:coverage`
  - `pnpm --dir packages/setup-cli test:coverage`
  - `pnpm typecheck`
  - `git diff --check -- <touched paths>`
- Blocked:
  - `bash scripts/workspace-verify.sh test:diff <touched paths>` failed in unrelated `scripts/research-init.test.ts` research-runner tests before the touched package tests.
- Audits:
  - Security/privacy review: no findings.
  - Coverage-write review: no edits needed.
  - Task-finish review: one boundary-guard finding fixed, rerun had no findings.
Completed: 2026-04-28
