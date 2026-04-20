## Title

Finish greenfield deprecation of persisted `assistant.cron.tick`.

## Goal

Make `assistant.cron.tick` impossible to append or parse as ordinary hosted ingress while keeping any unavoidable residual compatibility internal to runner/runtime plumbing only. The steady-state shape is `triggerKind = runtime_timer` plus internal `runtime.timer` for zero-event runtime work.

## Scope

- `agent-docs/references/hosted-run-protocol.md`
- `packages/hosted-execution/src/{contracts,parsers}.ts`
- `packages/assistant-runtime/src/hosted-runtime/{execution,maintenance,summary}.ts`
- focused `packages/{hosted-execution,assistant-runtime}/test/**`
- `apps/web/src/lib/hosted-ingress/queue.ts`
- focused `apps/web/test/**`

## Constraints

- Preserve the current runDrain-only runner/parser hard-cut.
- Do not reintroduce `request.wake` or any single-wake execution fallback.
- Do not touch the separate `apps/cloudflare` test/helper lane already registered in the coordination ledger.
- If any `assistant.cron.tick` residue remains temporarily, it must be runtime-internal only and not part of persisted/web-owned ingress or event contracts.

## Verification

- passed: `pnpm --dir packages/hosted-execution build`
- passed: `pnpm --dir packages/assistant-runtime typecheck`
- passed: `pnpm --dir packages/hosted-execution test`
- passed: `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-ingress-queue.test.ts apps/web/test/hosted-ingress-payload-unification.test.ts apps/web/test/hosted-ingress-store-data.test.ts`
- passed: `git diff --check`
- partial: `bash scripts/workspace-verify.sh test:diff ...`
  The shared/runtime/web owners passed through `packages/{assistant-runtime,cli,cloudflare-hosted-control,hosted-execution}`.
  The lane then failed in reverse-dependent `apps/cloudflare verify` because existing Cloudflare tests/helpers still construct `assistant.cron.tick` as `HostedIngressEnvelope` / `runDrain.events[].wake`.
  Those files are already owned by the active coordination-ledger row for Cloudflare test/helper cleanup, so this slice intentionally left them untouched.

## Notes

- Durable docs already describe `runtime.timer` as the internal representation for zero-event due work; this slice aligns the remaining shared contracts and focused tests with that direction.
- The intended steady state is no persisted or web-produced `assistant.cron.tick`. Any temporary leftover support must stay isolated behind runtime-only compatibility surfaces.

Status: completed
Updated: 2026-04-20
Completed: 2026-04-20
