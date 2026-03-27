# Cloudflare Hosted Runner Patch Landing

Status: completed
Created: 2026-03-27
Updated: 2026-03-27

## Goal

Land the remaining behavior from the supplied Cloudflare hosted-runner final-pass patch on top of the current branch without discarding newer scaffold work that already exists here.

## Scope

- Serialize one-shot hosted runs inside each runner process so per-user encrypted env overrides cannot overlap through shared `process.env`.
- Add a bounded timeout for the runner's durable commit callback.
- Prefer `HOSTED_EXECUTION_CLOUDFLARE_*` dispatch env names in `apps/web` while keeping the legacy aliases working.
- Improve hosted dispatch error detail, add the idempotency follow-up guide, and align examples/docs/tests with the real branch state.

## Constraints

- Preserve the current Worker plus Durable Object plus separate Node runner shape.
- Keep the richer checked-in runner image and ignore-file scaffolding already present instead of reverting to the older patch snapshot.
- Avoid touching unrelated in-flight `apps/web` or repo-root work outside the hosted execution surface.

## Verification Plan

- Focused `apps/cloudflare` and `apps/web` tests while iterating.
- Required repo commands: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`.
- Required completion-workflow audit passes via spawned subagents for simplify, coverage, and final review.

## Outcome

- Added per-process hosted runner serialization plus a bounded durable commit timeout for the Node runner path.
- Switched hosted-web dispatch wiring to prefer `HOSTED_EXECUTION_CLOUDFLARE_*` env names while keeping legacy aliases working, and surfaced bounded response-body detail on non-200 dispatch failures.
- Fixed the final-review blank-preferred-env fallback bug so empty `HOSTED_EXECUTION_CLOUDFLARE_*` values still fall back to legacy aliases, and added deterministic regression coverage for runner serialization/env isolation plus failed-run queue release.
- Aligned the hosted execution examples/docs, including the idempotency follow-up guide.
- `pnpm typecheck` passed and `pnpm --dir apps/web test` passed.
- Direct proof: a one-off `tsx` invocation of `runHostedExecutionJob()` for `member.activated` completed successfully and returned the normal bootstrap summary.
- `pnpm test` and `pnpm test:coverage` now both reach `apps/cloudflare` and remain blocked by the unrelated pre-existing shared-food import regression in `apps/cloudflare/test/node-runner.test.ts` (`VaultError: Food was not found`).
