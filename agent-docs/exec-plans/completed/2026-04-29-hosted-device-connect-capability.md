# Hosted Device Connect Capability

## Goal

Give hosted Cloudflare assistant turns the same device-connect product capability as local runs without forwarding provider credentials into the runner shell or starting the local daemon.

## Scope

- Wire hosted execution context to the existing hosted device-sync control-plane port.
- Make assistant prompt capability detection reflect the hosted execution context.
- Add focused regression coverage for hosted provider availability.

## Constraints

- Keep provider credentials Worker/web-control-plane owned.
- Do not introduce hosted daemon state, PID tracking, or `.runtime/operations/device-sync` launcher state in Cloudflare.
- Preserve unrelated dirty work in the current checkout.

## Verification

- `pnpm --dir packages/assistant-runtime test -- hosted-runtime-workspace-assistant-phase.test.ts`
- `pnpm --dir packages/assistant-engine test -- assistant-prompt-capability-availability.test.ts`
- `pnpm --dir packages/assistant-runtime typecheck`
- `pnpm --dir packages/assistant-engine typecheck`
- `git diff --check -- packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts packages/assistant-runtime/test/hosted-runtime-workspace-assistant-phase.test.ts packages/assistant-engine/src/assistant/provider-turn/planning.ts packages/assistant-engine/test/assistant-prompt-capability-availability.test.ts`
Status: completed
Updated: 2026-04-29
Completed: 2026-04-29
