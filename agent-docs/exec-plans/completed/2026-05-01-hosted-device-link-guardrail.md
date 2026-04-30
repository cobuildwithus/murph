# Hosted Device Link Guardrail

## Goal

Prevent Murph assistant turns from inventing wearable connection URLs when the real hosted device-connect helper is unavailable or fails.

Success criteria:

- The assistant prompt explicitly forbids fabricated wearable OAuth/connect URLs.
- The prompt allows sending a link only when it is present in the current turn from the hosted runtime/helper.
- Focused assistant-engine tests cover the guardrail.

## Scope

- `packages/assistant-engine/src/assistant/system-prompt.ts`
- Directly coupled assistant-engine prompt tests only.

## Constraints

- Do not change hosted OAuth routes or device-sync control-plane behavior.
- Preserve existing helper behavior: when `issueDeviceConnectLink` is callable, the pre-model helper can still issue a real link.
- Preserve unrelated dirty-tree edits.

## State

Implemented and reviewed. Ready to archive.

## Verification

- `pnpm --dir packages/assistant-engine exec vitest run test/model-behavior.test.ts --no-coverage`
- `pnpm test:diff packages/assistant-engine/src/assistant/system-prompt.ts packages/assistant-engine/test/model-behavior.test.ts`
- `pnpm typecheck`
- `security-privacy-review`: no findings.
- `coverage-write`: existing tests sufficient; no file changes.
- `task-finish-review`: no findings.
Status: completed
Updated: 2026-05-01
Completed: 2026-05-01
