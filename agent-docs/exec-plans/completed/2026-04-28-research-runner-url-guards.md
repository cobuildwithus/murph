# Research Runner URL Guards

## Goal

Stop Health Commons research harvests from waking stale or cross-owned ChatGPT URLs, and make send failures fail closed before a bad URL becomes saved seam state.

## Scope

- `scripts/research-run.mjs`
- `scripts/review-gpt-browser-profile.sh`
- focused tests in `scripts/research-init.test.ts` and `packages/cli/test/release-script-coverage-audit.test.ts`
- Health Commons research skill guidance if the operational rule changes
- coordination ledger row for this plan

## Non-Goals

- Do not change Health Commons content packages.
- Do not reintroduce aggressive resend workers.
- Do not move harvests across browser lanes automatically.

## Verification

- `node --check scripts/research-run.mjs`
- focused Vitest for research runner tests
- `pnpm typecheck` unless blocked by unrelated dirty-tree work

## State

- Completed.
- `pnpm exec vitest run scripts/research-init.test.ts --config scripts/vitest.config.ts --no-coverage`
- `pnpm exec vitest run packages/cli/test/release-script-coverage-audit.test.ts -t 'browser profile recovery' --config packages/cli/vitest.workspace.ts --no-coverage`
- `bash -n scripts/review-gpt-browser-profile.sh && node --check scripts/research-run.mjs`
- `pnpm typecheck`
- `git diff --check -- .agents/skills/health-commons-research/SKILL.md packages/cli/test/release-script-coverage-audit.test.ts scripts/research-init.test.ts scripts/research-run.mjs scripts/review-gpt-browser-profile.sh pnpm-lock.yaml patches/@cobuild__review-gpt@0.5.84.patch`
Status: completed
Updated: 2026-04-29
Completed: 2026-04-29
