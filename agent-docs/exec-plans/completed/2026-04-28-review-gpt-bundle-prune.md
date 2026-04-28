# Review GPT Bundle Prune

Status: completed
Created: 2026-04-28
Updated: 2026-04-28

## Goal

- Make the normal `review:gpt` upload bundle smaller and safer by excluding generated/output package trees and Health Commons data from review-gpt-specific packaging only.

## Success criteria

- `pnpm review:gpt` and `pnpm review:gpt:full` resolve to review-gpt-specific package scripts.
- Review-gpt package scripts exclude `output-packages/**`, `packages/health-commons/content/**`, and `packages/health-commons/generated/**`.
- Health Commons research packaging remains unchanged and can still include its workspace/reference files.
- Focused tests and syntax checks pass.

## Scope

- In scope:
  - `scripts/review-gpt*.config.sh`
  - review-gpt-specific package wrapper scripts
  - focused repo-tools tests
  - narrow workflow documentation if needed
- Out of scope:
  - Health Commons research workflow package scripts
  - `pnpm zip:src` / generic audit package behavior
  - Health Commons content or generated catalog changes

## Constraints

- Technical constraints:
  - Preserve `scripts/package-audit-context.sh` and `scripts/package-audit-context-full.sh` for non-review-gpt callers.
  - Keep the exclusion mechanical and test-covered rather than relying on prompt instructions.
- Product/process constraints:
  - Do not delete, rewrite, or narrow the Health Commons research workflow.
  - Do not expose local identifiers, secrets, or private paths in generated files, logs, docs, commits, or handoff.

## Risks and mitigations

1. Risk: pruning Health Commons from all packaging would break research sends.
   Mitigation: add review-gpt-only wrapper scripts and leave generated research package scripts unchanged.
2. Risk: only the ZIP is pruned while the repomix attachment still includes large/sensitive paths.
   Mitigation: carry the same exclusion patterns in review-gpt config and package manifests.

## Tasks

1. Add review-gpt-specific package wrappers.
2. Point normal and full review-gpt configs to those wrappers.
3. Add focused tests for script selection and ZIP contents.
4. Run direct package checks, repo-tools tests, typecheck, and required audits.

## Decisions

- Exclude Health Commons data roots, not all code that happens to reference Health Commons.

## Verification

- Passed:
  - `bash -n scripts/package-review-gpt-context.sh scripts/package-review-gpt-context-full.sh scripts/review-gpt.config.sh scripts/review-gpt-full.config.sh`
  - `pnpm exec vitest run scripts/review-gpt-context.test.ts --config scripts/vitest.config.ts --no-coverage`
  - `git diff --check`
  - `pnpm test:repo-tools`
  - `pnpm exec vitest run packages/cli/test/release-script-coverage-audit.test.ts --config vitest.config.ts --no-coverage -t "keeps the lean and full review-gpt wrappers wired"`
  - `pnpm exec vitest run packages/cli/test/release-script-coverage-audit.test.ts --config vitest.config.ts --no-coverage -t "exposes root-owned release scripts"`
  - `pnpm review:gpt --dry-run --preset simplify` without sending to ChatGPT
  - Dry-run ZIP and repomix artifact entry checks showed no file entries under `output-packages/**`, `packages/health-commons/content/**`, or `packages/health-commons/generated/**`.
- Partial:
  - `pnpm typecheck` passed before the final CLI coverage assertion update; after concurrent active-turn edits landed in the working tree, a rerun failed in unrelated `packages/assistant-engine/src/assistant/active-turn-input-controller.ts`.
Completed: 2026-04-28
