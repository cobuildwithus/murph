# 2026-04-01 Assistant Auto-Reply Full Murph Support

## Goal (incl. success criteria)

- Let message-triggered assistant auto-reply run on any configured provider route instead of rejecting direct-CLI providers.
- Give auto-reply the same full Murph tool surface as other assistant turns, including assistant memory/state/cron and canonical vault writes.
- Update durable trust-boundary docs and focused regression tests so setup defaults, runtime behavior, and hosted/local expectations are aligned.

## Constraints / Assumptions

- Preserve unrelated dirty-tree edits and keep the implementation scoped to assistant auto-reply authority/routing, not a broad provider refactor.
- Keep hosted ingress authorization and bound user/vault scoping intact.
- Do not collapse Murph tool authority into broader hosted control-plane or ambient host-shell authority.

## Key Decisions

- Remove the bounded auto-reply tool-catalog special case and reuse the default full Murph tool catalog for message-triggered turns.
- Stop using provider `supportsBoundTools` as the gate for auto-reply eligibility; provider capabilities still only describe transport/runtime wiring differences.
- Keep hosted worker-bound user/token boundaries and other host/control-plane protections unchanged while accepting that any authorized inbound message can act as the bound operator.

## State

- Ready to close

## Done

- Read repo routing, reliability, completion-workflow, and trust-boundary docs.
- Confirmed the current failure comes from the explicit auto-reply gate that rejects non-`supportsBoundTools` providers.
- Confirmed setup/defaults can still save `codex-cli` as the default assistant even though the runtime currently rejects Codex auto-reply.
- Aligned the implementation direction with the product decision that inbound messaging turns should have full Murph autonomy, including canonical vault writes.
- Removed the bounded auto-reply tool/runtime gate so message-triggered turns reuse the default full Murph tool catalog on any provider route.
- Updated focused assistant regression tests so OpenAI-compatible auto-reply proves real assistant-state plus canonical journal writes through the built tool runtime, while Codex auto-reply proves the direct-CLI full-authority path.
- Updated durable architecture/security/index docs to reflect provider-agnostic full-Murph messaging authority while clarifying that provider transport still changes only the mechanism used to reach that authority.
- Ran focused verification and the mandatory final review audit; addressed the review findings without reopening the product decision.

## Now

- Close the plan with the scoped commit helper.

## Next

- None.

## Open Questions

- The product policy now intentionally treats accepted inbound messages as operator-authorized for the full default Murph tool catalog, including outward side-effectful tools if configured.

## Working Set (files / ids / commands)

- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `agent-docs/exec-plans/active/2026-04-01-codex-autoreply-support.md`
- `packages/assistant-core/src/assistant/provider-turn-runner.ts`
- `packages/cli/test/assistant-service.test.ts`
- `agent-docs/SECURITY.md`
- `ARCHITECTURE.md`
- `agent-docs/index.md`
- Verification:
  - `pnpm exec vitest run packages/cli/test/assistant-service.test.ts -t "auto-reply" --maxWorkers 1 --coverage.enabled false`
  - `pnpm exec vitest run packages/cli/test/assistant-provider.test.ts -t "resolveAssistantProviderCapabilities|OpenAI-compatible auto-reply|Codex auto-reply" --maxWorkers 1 --coverage.enabled false`
  - `pnpm exec tsc -p packages/cli/tsconfig.json --noEmit`
  - `pnpm typecheck`
  - `pnpm test` (known unrelated failure in `packages/cli/test/release-script-coverage-audit.test.ts`)
  - `pnpm test:coverage` (known unrelated failure in `packages/cli/test/stdin-input.test.ts`)
Status: completed
Updated: 2026-04-01
Completed: 2026-04-01
