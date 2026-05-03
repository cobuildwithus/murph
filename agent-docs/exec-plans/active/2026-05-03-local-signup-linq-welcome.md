## Goal

Diagnose local hosted Linq reply delivery so the next deterministic failure identifies whether the break is the local Codex bridge/provider, runtime event handling, or Linq delivery.

## Scope

- `packages/assistant-engine/src/assistant-codex/failures.ts`
- `packages/assistant-engine/src/assistant/automation/failure-observability.ts`
- `packages/assistant-engine/src/assistant/automation/reply.ts`
- `packages/assistant-engine/src/assistant/automation/shared.ts`
- `packages/assistant-runtime/src/hosted-runtime/maintenance.ts`
- `packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts`
- `packages/hosted-execution/src/observability.ts`
- `apps/cloudflare/src/node-runner-child.ts`
- `apps/cloudflare/src/user-runner.ts`
- focused assistant-engine, assistant-runtime, and Cloudflare verification

## Constraints

- Do not expose local paths, phone numbers, chat identifiers, tokens, raw model output, or provider payloads in logs/tests.
- Keep changes diagnostic-only for this pass.
- Do not change notification-turn behavior in this pass; shared Codex failure fields may be surfaced through existing notification redaction.

## Verification

- Focused assistant-engine failure-observability/automation tests.
- Focused assistant-runtime hosted maintenance tests.
- Focused Cloudflare runner env/log tests if worker log details change.
- Package typecheck or routed equivalent if feasible in the dirty tree.
