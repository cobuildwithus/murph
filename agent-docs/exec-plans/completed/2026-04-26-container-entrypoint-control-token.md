# Container Entrypoint Control Token

## Goal

Require the hosted runner container control token to be injected at startup, reject auth-free run mutation, and cap `/internal/run` request bodies before buffering.

Success criteria:

- `/health` remains unauthenticated and read-only.
- `/internal/run` fails closed when the startup control token is absent.
- A bearer token from the first request can no longer become the control token.
- Oversized run bodies are rejected before unbounded buffering.
- Focused container-entrypoint tests cover the behavior.

## Constraints

- Preserve the existing per-run proxy token contract.
- Do not broaden the container HTTP route surface.
- Do not log raw tokens, request bodies, hosted identifiers, secrets, or local paths.
- Preserve unrelated active Cloudflare runner/test edits in the dirty tree.

## State

Completed; formal spawned audits unavailable due account usage-limit errors.

## Done

- Read required repo routing, architecture, product, security, reliability, completion, and verification docs.
- Confirmed the current entrypoint can claim `controlToken` from the first bearer token and buffers request bodies without an explicit cap.
- Removed first-request control-token claiming and required startup token injection for `/internal/run`.
- Added bounded `/internal/run` request-body buffering with a 413 response for oversized bodies.
- Injected the Worker-generated runner control token into container startup env and kept the bearer check tied to that token.
- Added focused entrypoint and runner-container tests.
- Ran local security/coverage review after required audit subagents failed to start because the account hit a Codex usage limit.

## Now

- Done.

## Next

- Close the plan and make a scoped commit if the dirty shared ledger permits it.

## Open Questions

- None currently.

## Working Set

- `apps/cloudflare/src/container-entrypoint.ts`
- `apps/cloudflare/src/runner-container.ts`
- `apps/cloudflare/src/runner-env.ts`
- `apps/cloudflare/test/container-entrypoint.test.ts`
- `apps/cloudflare/test/runner-container.test.ts`
- `agent-docs/exec-plans/active/2026-04-26-container-entrypoint-control-token.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`

## Verification

- `pnpm --dir apps/cloudflare typecheck` passed.
- `pnpm exec vitest run apps/cloudflare/test/container-entrypoint.test.ts --config apps/cloudflare/vitest.node.workspace.ts --no-coverage` passed.
- `pnpm exec vitest run apps/cloudflare/test/runner-container.test.ts --config apps/cloudflare/vitest.node.workspace.ts --no-coverage` passed.
- `pnpm test:diff apps/cloudflare/src/container-entrypoint.ts apps/cloudflare/src/runner-container.ts apps/cloudflare/src/runner-env.ts apps/cloudflare/test/container-entrypoint.test.ts apps/cloudflare/test/runner-container.test.ts` passed.
- `pnpm typecheck` failed in unrelated active work: `packages/assistant-engine/test/assistant-local-service-runtime.test.ts:527` expects a `startTelegramTyping` call on an empty tuple/never type.
Status: completed
Updated: 2026-04-26
Completed: 2026-04-26
