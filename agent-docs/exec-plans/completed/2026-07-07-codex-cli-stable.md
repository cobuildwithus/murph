# Update Codex CLI to stable 0.142.5

Status: completed
Created: 2026-07-07
Updated: 2026-07-07

## Goal

- Update Murph's pinned Codex CLI/runtime dependency from `0.143.0-alpha.35` to the current stable `latest` dist-tag, `0.142.5`, keeping local tests, hosted runner images, CI handoff image tags, and pnpm supply-chain policy in sync.

## Success criteria

- `@murphai/assistant-engine` depends on `@openai/codex@0.142.5`.
- The committed lockfile resolves the matching Codex native platform packages.
- Hosted runner Dockerfiles, image-tag contract helpers, and direct tests reference the same Codex CLI version.
- Dependency guard, dependency audit, focused Codex app-server tests, and relevant diff verification pass or any unrelated blocker is named precisely.

## Scope

- In scope: `@openai/codex` manifest/lockfile update; removal or correction of the now-stale alpha minimum-release-age exception; hosted runner base image version strings; tests/comments that assert the live pinned version.
- Out of scope: changing Codex models, prompt behavior, auth flow, hosted runtime protocol, historical completed plan snapshots, or unrelated dirty `apps/web` work.

## Constraints

- Technical constraints: keep dependency specs exact and registry-sourced; do not bypass pnpm supply-chain controls; preserve hosted runner image tag consistency.
- Product/process constraints: preserve unrelated working-tree edits; use scoped verification unless full acceptance is required by a wider change.

## Risks and mitigations

1. Risk: Codex CLI protocol or bundled model-catalog behavior differs between the current alpha and stable line.
   Mitigation: run the real Codex app-server/scripted runtime test and hosted-runtime Codex config tests in addition to dependency checks.
2. Risk: Docker/base-image version references drift from the package lock.
   Mitigation: update the contract helper and tests alongside Dockerfile arguments and workflow image-save references.

## Tasks

1. Confirm the current npm stable dist-tag and use it because the user requested latest stable after alpha flakiness.
2. Update package manifest, lockfile, pnpm supply-chain exception, Dockerfile args/tags, and live contract tests/comments.
3. Run dependency and focused Codex verification.
4. Run final review, close the plan, and commit the scoped change if checks are green.

## Decisions

- Use `0.142.5`, the current npm `latest` stable dist-tag as of 2026-07-07. This intentionally leaves the newer `0.143.0-alpha.*` track because the user reported alpha flakiness.

## Verification

- Passed: `pnpm install --lockfile-only`.
- Passed: `pnpm install`.
- Passed: `pnpm deps:guard`.
- Failed unrelated: `pnpm deps:audit` reports existing high advisories in `ws`, `form-data`, `vite`, `protobufjs`, `undici`, and `repomix`; the Codex package change is not on those dependency paths.
- Reviewed: `pnpm deps:ignored-builds` still reports blocked `@reown/appkit@1.8.9`.
- Passed: `pnpm --dir packages/assistant-engine exec codex --version` reported `codex-cli 0.142.5`, and `codex app-server --help` succeeded.
- Passed: `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-codex-scripted-runtime.test.ts` (11 tests).
- Passed: `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --no-coverage test/hosted-runtime-codex-config.test.ts` (37 passed, 2 skipped).
- Passed: `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts --no-coverage apps/cloudflare/test/container-image-contract.test.ts` (11 tests).
- Passed: hosted runner model-catalog transform smoke with stable `codex debug models --bundled`.
- Passed: `pnpm typecheck`.
- Passed: `git diff --check` for the scoped Codex files.
Completed: 2026-07-07
