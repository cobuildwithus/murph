# Fix hosted-local e2e Prisma bootstrap reset

Status: completed
Created: 2026-04-24
Updated: 2026-04-24
Completed: 2026-04-24

## Goal

- Make the hosted-local Cloudflare e2e lanes pass when the local Postgres database already contains prior rows from earlier dev runs.
- Restore the hosted-local Telegram lane by keeping container-runner platform Telegram URLs reachable from the local runner container.

## Success criteria

- `pnpm --dir apps/cloudflare test:e2e:linq-delivery:local` passes from a non-empty local Postgres state.
- `pnpm --dir apps/cloudflare test:e2e:telegram:local` passes with the local Telegram stub routed through the hosted runner container.
- The same reset behavior is available to the other hosted-local e2e lanes that share the harness.
- Normal local hosted dev startup keeps its current non-reset behavior unless the reset is explicitly requested.

## Scope

- `scripts/dev-hosted-local/{config.ts,types.ts,stack.ts,config.test.ts,stack.test.ts}`
- `apps/cloudflare/test/helpers/{hosted-local-dev-harness.ts,hosted-local-dev-harness.test.ts,hosted-local-full-stack-scenario.ts}`
- `apps/cloudflare/src/user-runner/runner-run-processor.ts`
- directly coupled `apps/cloudflare/test/runner-run-processor.test.ts`
- Directly coupled hosted-local e2e proof only
- `agent-docs/exec-plans/active/{2026-04-24-hosted-local-e2e-db-reset.md,COORDINATION_LEDGER.md}`

## Constraints

- Keep the change in the hosted-local bootstrap, directly coupled runner env seam, and e2e harness only.
- Do not make `pnpm dev` force-reset a local database by default.
- Preserve unrelated dirty-tree work and keep any `apps/cloudflare/src/user-runner/runner-run-processor.ts` edit minimal because that file also has an overlapping observability lane.

## Risks and mitigations

1. Risk: a blanket local reset would be destructive for ordinary development.
   Mitigation: make reset opt-in and enable it only from the hosted-local e2e harness.
2. Risk: the e2e harness shares bootstrap code with other local hosted flows.
   Mitigation: cover the config and stack command selection with focused unit tests before rerunning e2e.

## Tasks

1. Add an opt-in hosted-local reset control to the dev stack config.
2. Enable that control from the hosted-local e2e harness only.
3. Update focused config/stack/harness tests.
4. Rerun the failing hosted-local e2e lanes and the required repo verification.

## Decisions

- Current failing root cause: local e2e bootstrap uses `prisma db push --accept-data-loss` against a non-empty loopback Postgres database, which now fails on the required `hosted_run.ingress_event_ids_json` column addition.
- Preferred fix direction: keep the reset behavior e2e-only via an explicit flag instead of changing the default local dev bootstrap contract.
- Current Telegram lane root cause: the container runner path builds Telegram platform env from config source but does not request loopback URL rewriting there, so `TELEGRAM_API_BASE_URL=http://127.0.0.1:*` stays container-local and the runner cannot reach the hosted-local Telegram stub.
- Follow-up Telegram cleanup root cause: worker-side cleanup should keep the original worker-reachable Telegram base URL, while the container runner job needs the host-rewritten container URL for outbound sends.

## Verification

- Commands to run:
  - focused `vitest` for `scripts/dev-hosted-local/{config,stack}.test.ts`
  - focused `vitest` for `apps/cloudflare/test/helpers/hosted-local-dev-harness.test.ts`
  - `pnpm --dir apps/cloudflare test:e2e:linq-delivery:local`
  - `pnpm --dir apps/cloudflare test:e2e:telegram:local`
  - `pnpm --dir apps/cloudflare test:e2e:duplicate-commit:local`
  - `pnpm verify:acceptance`
- Expected outcomes:
  - hosted-local e2e runs provision a clean schema even when the shared local Postgres already has prior rows
  - non-e2e local hosted startup still uses the existing non-reset path by default
- Results:
  - `pnpm exec vitest run --config scripts/vitest.config.ts scripts/dev-hosted-local/config.test.ts scripts/dev-hosted-local/stack.test.ts --no-coverage` passed.
  - `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/helpers/hosted-local-dev-harness.test.ts --no-coverage` passed.
  - `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/runner-run-processor.test.ts --no-coverage` passed after the runner/worker Telegram env split.
  - `pnpm --dir apps/cloudflare typecheck` passed.
  - `pnpm --dir apps/cloudflare test:e2e:linq-delivery:local` passed.
  - `pnpm --dir apps/cloudflare test:e2e:telegram:local` passed.
  - `pnpm --dir apps/cloudflare test:e2e:duplicate-commit:local` passed.
  - `bash scripts/workspace-verify.sh test:diff scripts/dev-hosted-local/config.ts scripts/dev-hosted-local/types.ts scripts/dev-hosted-local/stack.ts scripts/dev-hosted-local/config.test.ts scripts/dev-hosted-local/environment.test.ts scripts/dev-hosted-local/stack.test.ts apps/cloudflare/src/user-runner/runner-run-processor.ts apps/cloudflare/test/helpers/hosted-local-full-stack-scenario.ts apps/cloudflare/test/helpers/hosted-local-linq-support.ts apps/cloudflare/test/runner-run-processor.test.ts` passed and kept the proof on the touched `apps/cloudflare` owner.
  - `pnpm verify:acceptance` passed after the broader branch blocker work was completed.
  - Required `coverage-write` audit pass completed with no additional proof edits needed.
  - Required `task-finish-review` audit pass completed with no findings.
Completed: 2026-04-24
