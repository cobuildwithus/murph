# Hosted Bootstrap And User Env Boundary

Status: completed
Created: 2026-03-27
Updated: 2026-03-27

## Goal

Make hosted bootstrap an explicit event-driven operation instead of a hidden side effect of every hosted run, and store hosted per-user env overrides independently from the broader `agent-state` bundle so small config edits do not churn that bundle artifact.

## Scope

- Remove the current unconditional hosted bootstrap mutation from the generic hosted runtime path.
- Handle bootstrap only for the explicit activation/bootstrap event lane and record the result through the normal hosted execution summary/bundle flow.
- Move hosted per-user env persistence from embedded `.healthybob/hosted/user-env.json` files inside `agent-state` snapshots to a separately encrypted hosted object keyed per user.
- Keep runner startup injection behavior by loading the separately stored hosted user env and passing it into the one-shot runtime before execution.
- Update bundle/runtime docs and focused tests so the new bootstrap and storage contract is explicit.

## Constraints

- Preserve the existing worker -> DO -> native container execution model and the current commit/finalize bundle flow.
- Do not expand the hosted event surface beyond the minimum explicit bootstrap seam needed for this change; prefer reusing `member.activated` unless tests show a separate event is required immediately.
- Keep plaintext hosted user env values out of Durable Object state and broader `agent-state` snapshots.
- Preserve existing per-user env allowlist validation and runner env precedence.
- Avoid broad SQLite queue-store changes while the active DO state-machine refactor is in progress.

## Risks

1. Removing hidden bootstrap could strand first-run users without required vault or inbox initialization.
   Mitigation: perform bootstrap explicitly for activation/bootstrap events and add regression coverage for both activation and ordinary event runs.
2. Separating user env storage could accidentally drop overrides during bundle finalize races.
   Mitigation: keep env reads/writes on an independent encrypted object and merge the latest stored env into runner startup/config status paths rather than bundle bytes.
3. Doc drift is likely because current architecture/runtime docs still describe user env as part of `agent-state`.
   Mitigation: update the hosted execution docs in the same change as the code/tests.

## Verification Plan

- Focused hosted-runner tests while iterating: `apps/cloudflare/test/node-runner.test.ts`, `apps/cloudflare/test/user-runner.test.ts`, and `packages/runtime-state/test/hosted-bundle.test.ts`.
- Required repo commands after integration: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`.
- Direct scenario proof should show one `member.activated` run performing bootstrap and one non-activation event run avoiding bootstrap side effects.

## Outcome

- Explicit hosted bootstrap now runs only on `member.activated`; non-activation empty-bundle runs fail fast instead of silently mutating config.
- Hosted per-user env overrides now live in a dedicated encrypted R2 object and are injected at runner start instead of being embedded in `agent-state`.
- Hosted `agent-state` no longer snapshots `.healthybob/hosted/user-env.json`.

## Verification Results

- Passed: `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts --no-coverage --maxWorkers 1 apps/cloudflare/test/user-env.test.ts apps/cloudflare/test/user-runner.test.ts apps/cloudflare/test/node-runner.test.ts apps/cloudflare/test/index.test.ts`
- Passed: `pnpm exec vitest run --config apps/cloudflare/vitest.workers.config.ts --no-coverage --maxWorkers 1`
- Passed: `pnpm exec vitest run --config vitest.config.ts --coverage.enabled=false packages/runtime-state/test/hosted-bundle.test.ts`
- Blocked, unrelated: `pnpm typecheck` fails in `packages/parsers/src/{inboxd/bridge.ts,inboxd/pipeline.ts}`
- Blocked, unrelated: `pnpm test` and `pnpm test:coverage` fail on the tracked `apps/web/postcss.config.mjs` source-artifact guard
- Blocked, unrelated: `pnpm --dir apps/cloudflare test:node` fails in `packages/cli/src/index.ts` and `packages/runtime-state/src/device-sync.ts`
