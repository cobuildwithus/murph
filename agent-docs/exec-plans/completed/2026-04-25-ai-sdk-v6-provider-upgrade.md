# AI SDK V6 Provider Upgrade

## Goal

Upgrade the assistant AI SDK package set so the OpenAI Responses provider uses the AI SDK v6-native provider specification and stops emitting v2 compatibility warnings, while preserving current hosted assistant behavior.

Success criteria:

- `@ai-sdk/openai` is upgraded to the current v3 provider-spec line.
- `ai` and directly coupled AI SDK provider packages are kept in a compatible current v6 set.
- The committed lockfile reflects the dependency update.
- Existing Vercel AI Gateway Responses routing remains available.

## Scope

- `packages/assistant-engine/package.json`
- `packages/cli/package.json`
- `pnpm-lock.yaml`
- Directly coupled assistant provider tests if package API changes require updates.

## Dependency Rationale

This needs package updates rather than a repo-local helper because the warning is emitted by AI SDK v6 when it receives an older provider-spec model object. The correct boundary is the upstream provider package version, not local request wrapping.

## Constraints

- Use public registry package versions only.
- Do not change hosted assistant model defaults or provider presets unless required by the package upgrade.
- Do not switch the runtime to the Gateway native provider in this change unless the upgraded Responses provider still warns or fails.
- Keep Responses support available for hosted assistant routes that depend on `/v1/responses` behavior.

## Current State

- Updated `ai` to `^6.0.168`.
- Updated `@ai-sdk/openai` to `^3.0.53`.
- Updated `@ai-sdk/openai-compatible` to `^2.0.41`.
- Lockfile now resolves a single `@ai-sdk/provider@3.0.8` provider-spec version across `ai`, `@ai-sdk/openai`, `@ai-sdk/openai-compatible`, and `@ai-sdk/gateway`.
- Direct model-instantiation proof shows Vercel AI Gateway Responses now returns `specificationVersion: "v3"` with provider `vercel-ai-gateway.responses`.
- CLI harness tests now assert official OpenAI Responses and Vercel AI Gateway Responses both use provider spec v3.

## Verification Plan

- `pnpm --dir packages/assistant-engine typecheck` - passed.
- `pnpm --dir packages/assistant-engine test:coverage` - passed.
- `pnpm --dir packages/cli typecheck` - passed.
- `pnpm --dir packages/cli test:source:coverage` - passed after the coverage-write audit added the Vercel AI Gateway Responses assertion.
- `pnpm deps:guard` - passed.
- `git diff --check` on touched paths - passed.
- `pnpm deps:ignored-builds` - exited 0 and reported the current workspace message: "Cannot identify as no node_modules found."
- `pnpm typecheck`, `pnpm test:diff ...`, and `pnpm --dir packages/cli verify:coverage` are blocked by unrelated `packages/hosted-execution/src/observability.ts:804` TS2352 in another active lane.
- `pnpm deps:audit` is red on existing non-AI SDK advisories in Playwright/Hono/Prisma/Vite transitive paths.
Status: completed
Updated: 2026-04-25
Completed: 2026-04-25
