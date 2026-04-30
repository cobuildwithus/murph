# Hosted Local Codex Container Dev

Status: completed
Created: 2026-05-01
Updated: 2026-05-01

## Goal

- Make root `pnpm dev` run the hosted Cloudflare container path with a local Codex bridge suitable for live Telegram first-contact testing from phone signup.

## Success criteria

- Local hosted dev can provide the Cloudflare runner container with a local-only Codex app-server endpoint without copying local Codex credentials into repo files or container env.
- Worker/container runtime env policy forwards only the narrow local-dev bridge setting needed by hosted runtime.
- Focused tests cover local-dev config/env behavior and hosted Codex config bootstrap behavior.
- Typecheck and focused verification pass or any unrelated blocker is documented.

## Scope

- In scope:
  - Root hosted-local dev launcher and generated Cloudflare env/config.
  - Hosted runner env policy and assistant-runtime Codex bootstrap.
  - Focused tests for the above seams.
- Out of scope:
  - Product changes to Telegram signup/onboarding behavior.
  - Production deployment secret handling beyond preserving existing Vercel AI Gateway path.
  - Browser/Privy UI changes.

## Constraints

- Do not copy, print, commit, or mount raw local Codex auth/config material.
- Keep production hosted assistant defaults on Vercel AI Gateway.
- Preserve unrelated dirty hosted, device-sync, and Health Commons work.

## Risks and mitigations

1. Risk: Local dev accidentally weakens hosted production assistant config.
   Mitigation: Gate local Codex bridge env to development/test paths and keep production provider validation unchanged.
2. Risk: Local Codex credentials leak through generated files, logs, or container env.
   Mitigation: Keep Codex auth on the host-side Codex process, restrict bridge binds to loopback or the resolved Docker bridge host, write proxy secrets only to `0600` local dev files, omit bridge secrets from Wrangler `--var` and child command envs, and redact/suppress bridge diagnostics.

## Tasks

1. [x] Inspect env boundaries and Cloudflare local container constraints.
2. [x] Implement local Codex bridge wiring for `pnpm dev`.
3. [x] Add focused tests.
4. [x] Run typecheck and focused tests.
5. [x] Run mandatory review passes.
6. [x] Finish with a scoped commit.

## Decisions

- Use a host-side Codex app-server bridge instead of copying local Codex credentials into the Cloudflare container.
- The bridge is tokened, local-dev-only, and forwards only the Codex app-server stream; it leaves local Codex auth/config on the host.
- `MURPH_DEV_CODEX_BRIDGE=0` strips stale local Codex proxy env so the off switch cannot inherit a dead bridge from shell/env-file state.
- Explicit bridge bind overrides are limited to loopback or the resolved Docker bridge host, not arbitrary private LAN interfaces.

## Verification

- Commands to run:
  - `pnpm exec vitest run --config scripts/vitest.config.ts scripts/dev-hosted-local/config.test.ts scripts/dev-hosted-local/codex-bridge.test.ts scripts/dev-hosted-local/stack.test.ts scripts/dev-hosted-local/environment.test.ts --no-coverage` (passed)
  - `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts test/hosted-runtime-codex-config.test.ts --no-coverage` (passed)
  - `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/runner-env.test.ts apps/cloudflare/test/helpers/hosted-local-dev-harness.test.ts --no-coverage` (passed)
  - `pnpm typecheck` (passed)
  - `pnpm test:diff ...` for touched local-dev/runtime/Cloudflare paths (blocked by unrelated `scripts/research-init.test.ts` Health Commons scaffold zip expectation)
  - `pnpm exec tsx --tsconfig tsconfig.base.json scripts/dev-hosted-local.ts --help` (passed)
  - `pnpm --dir packages/parsers build` (passed; rebuilt ignored dist so workspace typecheck could resolve package exports)
  - Mandatory coverage, simplification, security/privacy, and task-finish reviews completed. Security re-review had no blockers after final token-boundary fixes.
Completed: 2026-05-01
