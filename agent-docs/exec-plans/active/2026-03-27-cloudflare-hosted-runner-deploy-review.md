# Cloudflare Hosted Runner Deploy Review

Status: completed
Created: 2026-03-27
Updated: 2026-03-27

## Goal

Integrate the final deploy-review patch for the Cloudflare-hosted runner lane, including runner-container scaffolding, per-process runner job serialization, hosted-web dispatch timeout configuration, and the remaining config/docs truthfulness fixes.

## Scope

- Merge the full deploy-review patch onto the current tree without discarding existing hosted-runner/env-override work.
- Add the missing Cloudflare base-url config surface in Worker and hosted-web examples/docs.
- Serialize one-shot jobs inside a single runner process so per-user env overrides cannot bleed through shared `process.env`.
- Replace the misleading Worker fallback success payload with a 404 for unknown routes.
- Pin the Cloudflare app to a local `wrangler` dependency instead of `wrangler@latest`.
- Tighten root ignore files for Cloudflare local secret files.

## Constraints

- Preserve the current Worker plus Durable Object plus separate Node runner architecture.
- Keep the richer existing docs/runtime behavior already in the worktree; merge the patch intent instead of reverting to older file contents.
- Avoid touching unrelated dirty files outside the declared scope.
- Keep deployment/docs statements truthful; do not invent unimplemented production automation.

## Risks

1. The current architecture can still duplicate side effects after partial failure if outbound work succeeds before the durable commit completes.
   Mitigation: keep this risk documented and avoid claiming stronger guarantees than the current flow provides.
2. Package-manager drift could leave the repo using remote `wrangler@latest` despite the script update.
   Mitigation: add the app-local dependency and update lockfile state if needed.
3. Concurrent runner execution could still regress if serialization coverage is weak.
   Mitigation: add a focused concurrency test around the runner server queue.

## Verification Plan

- Focused `apps/cloudflare` and `apps/web` tests for the touched behavior.
- Required repo commands: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`.
- Required completion-workflow audit passes via spawned subagents for simplify, coverage, and final review.

## Outcome

- Added the deploy-review follow-up across the Cloudflare worker, runner server, hosted-web dispatch env parsing, and the surrounding config/docs surface.
- Serialized one-shot runner jobs inside a single process and added regressions for both overlap prevention and queue recovery after a failed job.
- Made unknown worker routes return 404, added the missing Cloudflare base-url config surface, and raised the hosted-web dispatch timeout to a configurable 30s default.
- Switched the Cloudflare app from `wrangler@latest` drift to a local pinned dependency recorded in `pnpm-lock.yaml`.
- Tightened the runner image to use the checked-in lockfile without an unnecessary full-workspace build.
- `pnpm typecheck` passed, focused Cloudflare and hosted-web regressions passed, and a direct `tsx` worker request confirmed the unknown-route 404.
- Required repo-wide `pnpm test` and `pnpm test:coverage` remain blocked by unrelated pre-existing failures in `packages/contracts` schema-artifact drift; the broader `apps/cloudflare` package test also still has an unrelated red shared-food import regression in `apps/cloudflare/test/node-runner.test.ts`.
