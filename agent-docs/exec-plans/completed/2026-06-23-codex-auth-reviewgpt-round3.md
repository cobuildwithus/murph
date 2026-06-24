# Hosted Codex Auth ReviewGPT Round 3

## Goal

Fix accepted ReviewGPT round-3 blockers on the hosted Codex auth PR without adding a broader credential-control architecture in this branch.

Success criteria:
- Hosted managed ChatGPT OAuth credentials are not made durable through hosted workspace snapshots.
- Hosted runtime state mutated by post-checkpoint mailbox effects is checkpointed before fresh work is accepted or the invocation returns.
- Focused tests cover the changed boundaries.
- Required verification passes before commit/push.

## Constraints

- Keep the design simple and fail closed where the current runtime cannot provide a real credential boundary.
- Preserve local-dev seeded subscription auth behavior.
- Do not preserve a UI/runtime state that claims a durable hosted ChatGPT connection when the credential cannot be safely retained.

## Working Set

- `packages/assistant-runtime/src/hosted-runtime.ts`
- `packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts`
- `packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts`
- `packages/assistant-runtime/src/hosted-runtime/codex-config.ts`
- `packages/runtime-state/src/hosted-bundles.ts`
- Hosted Codex auth and snapshot tests
- Hosted runtime architecture docs
Status: completed
Updated: 2026-06-23
Completed: 2026-06-23
