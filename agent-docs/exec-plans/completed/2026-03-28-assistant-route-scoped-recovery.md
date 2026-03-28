# 2026-03-28 Assistant Route-Scoped Recovery

## Goal

- Fix assistant provider resume and recovery so same-provider failover cannot resume the wrong route, failed attempts do not mutate the canonical session before the turn succeeds, and setup/provider wrapper config handling preserves OpenAI-compatible defaults correctly.

## Scope

- `packages/cli/src/assistant/{service.ts,provider-turn-recovery.ts,provider-state.ts}`
- `packages/cli/src/{assistant-codex.ts,chat-provider.ts,setup-services.ts,assistant-cli-contracts.ts}`
- targeted `packages/cli/test/{assistant-codex.test.ts,assistant-provider.test.ts,assistant-service.test.ts,assistant-robustness.test.ts}`
- `agent-docs/exec-plans/active/{2026-03-28-assistant-route-scoped-recovery.md,COORDINATION_LEDGER.md}`

## Design

1. Make resume eligibility route-scoped by recording the last successful route identity alongside the canonical provider session metadata.
2. Keep recovered provider session ids from failed attempts out of the canonical session and store them in a separate route-keyed recovery record.
3. Prefer route-matched recovery state for later retries, but cold-start when the planned route identity differs.
4. Keep Codex resume invariant-safe by treating route-affecting config as immutable for an existing resumed session.
5. Preserve saved OpenAI-compatible headers during setup/default rewrites and route public provider execution through the shared provider-config normalization path.

## Constraints

- Preserve existing failover cooldown accounting and direct canonical-write guard behavior.
- Do not widen the change into Ink UI or unrelated provider-progress refactors already in flight.
- Keep session schema changes backward-compatible with existing stored assistant sessions.
Status: completed
Updated: 2026-03-28
Completed: 2026-03-28
