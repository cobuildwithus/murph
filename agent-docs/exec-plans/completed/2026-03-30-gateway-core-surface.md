# 2026-03-30 Gateway Core Surface

## Goal

- Land the final step-3 gateway cutover on top of the existing `murph/gateway-core` seam: local send/event/permission support plus the hosted Cloudflare hot projection and internal gateway routes, while still deferring MCP publication.

## Scope

- `agent-docs/exec-plans/active/2026-03-30-gateway-core-surface.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `ARCHITECTURE.md`
- `packages/cli/src/{gateway-core.ts,gateway/**,assistant/outbox.ts}`
- `packages/cli/test/{gateway-core.test.ts,gateway-local-service.test.ts}`
- `packages/assistantd/src/{service.ts,http.ts}`
- `packages/assistantd/test/{assistant-core-boundary.test.ts,http.test.ts}`
- `packages/assistant-runtime/src/hosted-runtime/{callbacks.ts,events.ts,execution.ts,models.ts,summary.ts}`
- `packages/hosted-execution/src/{builders.ts,contracts.ts,outbox-payload.ts,parsers.ts}`
- `apps/cloudflare/src/{gateway-store.ts,index.ts,user-runner.ts,worker-contracts.ts,execution-journal.ts,runner-outbound.ts}`
- `apps/cloudflare/test/{index.test.ts,user-runner.test.ts}`
- `apps/web/test/hosted-execution-contract-parity.test.ts`

## Progress Snapshot

- Step 1 is already landed in the live tree: `murph/gateway-core` exists as a transport-neutral contract surface.
- Step 2 is already landed in the live tree: local derived gateway reads now serve assistantd through opaque conversation/message/attachment ids.
- This plan tracks Step 3: route-bound send, short-retained gateway events, permissions stubs, and the hosted Cloudflare cutover to a hot derived gateway projection.
- Publishing the same surface through MCP remains explicitly deferred to a later step.

## Why This Step

- Vault truth remains canonical.
- The gateway surface should be an explicitly derived operational model over inbox captures, assistant sessions, sent outbox intents, and approval state, not a second source of truth.
- `assistantd` is the right local trust boundary for serving transport-facing local operations without moving canonical writes out of CLI/core ownership.
- Hosted Cloudflare should keep only a hot gateway projection plus live event log derived from commit/finalize callbacks; it should not answer transport-facing reads by hydrating the full runner workspace on every request.

## Intended Landing

- Keep opaque transport-facing conversation, message, and attachment ids derived from stable route keys.
- Complete the local gateway seam with route-bound send plus short-retained event polling/waiting and explicit permission stubs.
- Cut hosted Cloudflare over to the same seam by shipping a derived gateway projection snapshot through commit/finalize and serving hosted gateway reads/events from a hot Durable Object store.
- Add the hosted gateway send dispatch kind and route it through the same local gateway send helper used by the daemon/runtime.
- Leave MCP publication out of scope even though the seam is now ready for a later transport adapter.

## Constraints

- Preserve unrelated dirty worktree edits and overlapping active lanes.
- Treat the supplied patch as behavioral intent rather than blindly applying it to the live tree.
- Keep the gateway plane derived and operational only; do not introduce new canonical persistence.

## Plan

1. Extend the local `murph/gateway-core` implementation from read-only projection queries into the full route-bound gateway service: send, event polling/waiting, and permission stubs.
2. Cut the hosted runner, commit/finalize callbacks, and Cloudflare Durable Object over to a hot derived gateway projection that serves hosted read/event routes without hydrating the workspace per request.
3. Add the hosted `gateway.message.send` dispatch path plus focused regression coverage for assistantd, hosted worker routing, and Durable Object projection updates.
4. Run required verification, then the mandatory simplify and task-finish-review audit passes.

## Verification

- Passed: `pnpm --dir packages/cli build`
- Passed: `pnpm --dir packages/assistantd build`
- Passed: `pnpm --dir packages/cli exec vitest --run test/gateway-core.test.ts test/gateway-local-service.test.ts --coverage.enabled=false`
- Passed: `pnpm --dir packages/assistantd exec vitest --run test/assistant-core-boundary.test.ts test/http.test.ts --coverage.enabled=false`
- Passed: `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/index.test.ts apps/cloudflare/test/user-runner.test.ts --no-coverage`
- Passed: `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/node-runner.test.ts -t "posts a durable commit before returning when a commit callback is configured" --no-coverage`
- Passed: `pnpm exec vitest run --config apps/web/vitest.config.ts --project hosted-web apps/web/test/hosted-execution-contract-parity.test.ts --no-coverage`
- Failed outside this landing: `pnpm typecheck`
  - Existing failure in `packages/cli/test/cli-expansion-inbox-attachments.test.ts` complaining that an `attachments` property is not allowed on the current helper input type.
- Failed outside this landing: `pnpm test`
  - Existing failures in `packages/cli/test/inbox-cli.test.ts` for parser queue control/requeue coverage.
  - Existing failure in `packages/cli/test/health-tail.test.ts` where noun-specific and generic reads no longer align in the current tree.
- Failed outside this landing: `pnpm test:coverage`
  - Existing failure in `packages/cli/test/health-tail.test.ts`.
  - Existing coverage temp-file ENOENT at `coverage/.tmp/coverage-5.json`.

## Outcome

- Landed the step-3 gateway seam so local and hosted callers share the same derived conversation/message/event/send surface while keeping vault truth canonical.
- Preserved the `murph/gateway-core` vs `murph/gateway-core-local` split by moving pure snapshot helpers into a lightweight module and keeping vault-reading/send helpers on the local subpath.
- Added hosted Cloudflare hot projection storage, hosted gateway send dispatch, assistantd full gateway routes, and focused proof across CLI, assistantd, Cloudflare, and hosted web boundaries.
- MCP publication remains deferred.
Status: completed
Updated: 2026-03-30
Completed: 2026-03-30
