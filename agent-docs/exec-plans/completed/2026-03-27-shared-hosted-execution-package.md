# Shared Hosted-Execution Package

Status: completed
Created: 2026-03-27
Updated: 2026-03-27

## Goal

- Extract one shared hosted-execution workspace package that owns the hosted control-plane contract shared by `apps/web` and `apps/cloudflare`.

## Success criteria

- One package exports the hosted execution event/request/status contracts, header names, signature helpers, env readers, route builders, and typed caller helpers.
- `apps/web` stops owning its own dispatch signing/env parsing logic.
- `apps/cloudflare` stops owning its own hosted-execution signature/env parsing logic.
- Current route and auth behavior stays compatible, including the documented legacy env aliases for hosted dispatch.

## Scope

- In scope:
  - new shared workspace package plus minimal repo wiring so apps resolve it from source and build it normally
  - `apps/web` hosted-execution dispatch/env helpers and focused tests
  - `apps/cloudflare` hosted-execution auth/env helpers, smoke script, and focused tests
  - docs/config updates required by the new package graph or contract ownership move
- Out of scope:
  - rewriting the in-progress Cloudflare router / Durable Object orchestration seam in `apps/cloudflare/src/{index.ts,user-runner.ts}`
  - changing hosted event semantics, auth policy, or retry behavior
  - unrelated hosted onboarding, device-sync, or landing-page refactors already active in the worktree

## Constraints

- Preserve the current signed-dispatch contract and timestamp-skew behavior.
- Keep the shared package small and behavior-first; do not add speculative abstraction beyond the current caller/server contract.
- Respect the active exclusive runner migration lane on `apps/cloudflare/src/{index.ts,user-runner.ts}`.

## Verification plan

- Focused package/app tests for hosted-execution env/signing/client behavior.
- Required repo commands: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`.
- Required completion-workflow audit passes via spawned subagents for simplify, coverage, and finish review.
Completed: 2026-03-27
