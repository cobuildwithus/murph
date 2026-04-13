## Goal

Fix the repo state needed for a green local `release:check` and green GitHub push workflows after the Cloudflare hosted-local simplification follow-up.

## Why

- The latest push exposed a real CI regression in the local dev harness tests.
- A clean serial `release:check` also revealed stale `packages/assistant-runtime` tests that still refer to the removed commit effects-port API.
- The user explicitly asked for GitHub workflows to pass and for `release:check` to pass locally.

## Scope

- `scripts/dev-hosted-local/**`
- `packages/assistant-runtime/test/**`
- any directly-related helper files needed to restore truthful typecheck/release-check health

## Verification target

- focused `packages/assistant-runtime` test/typecheck proof as needed
- clean serial `pnpm release:check`
- GitHub push workflows for the resulting commit

## Outcome

- Local dev harness tests are type-safe again.
- `packages/assistant-runtime` test scaffolding matches the current no-commit runtime API.
- `release:check` passes locally.
- The replacement GitHub push workflows pass.
Status: completed
Updated: 2026-04-14
Completed: 2026-04-14
