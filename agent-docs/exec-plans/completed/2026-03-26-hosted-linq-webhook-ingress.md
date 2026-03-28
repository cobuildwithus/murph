# Hosted Linq Webhook Ingress in `apps/web`

Status: completed
Created: 2026-03-26
Updated: 2026-03-28

## Goal

Integrate the hosted Linq webhook ingress patch into the current tree so inbound Linq chats can land on one deployed webhook endpoint, be verified and routed in the hosted tier, and then be pulled by the paired local agent for canonical vault processing.

## Scope

- Add hosted Linq route handlers under `apps/web/app/api/linq/**`.
- Reuse shared Linq webhook parsing and signature verification helpers instead of duplicating connector logic.
- Add sparse hosted Postgres state for recipient-phone bindings and queued Linq webhook events only.
- Reuse the hosted browser-auth and agent-session pattern already used by the device-sync control plane.
- Add focused tests and the minimum required docs/env updates for the hosted Linq lane.

## Constraints

- Keep canonical inbox captures and vault writes local.
- Preserve unrelated dirty worktree edits already present in the repo.
- Avoid provider-specific logic duplication between the local inbox connector and the hosted ingress.
- Keep the public Linq webhook path lazy so it does not eagerly build browser-auth control-plane state.
- Keep the current `packages/web` app local-only; hosted Linq work lives in `apps/web`.

## Verification Plan

- Run focused `packages/inboxd` tests for the shared Linq webhook helper path.
- Run focused `apps/web` tests and app typecheck if the workspace is healthy enough for targeted verification.
- Run repo-level required checks: `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage`.

## Notes

- The supplied patch also restores the shared `config/workspace-source-resolution.ts` helper and widens `tsconfig.tools.json` coverage if the current tree still needs those pieces.
- The hosted tier must store only routing and queued-event state, not canonical inbox captures.

## Outcome

- Added hosted Linq route handlers under `apps/web/app/api/linq/**` for info, public webhook ingress, browser-authenticated bindings, agent pairing, and agent event polling.
- Added sparse Prisma-backed hosted Linq state in `apps/web` for recipient bindings and queued webhook events only.
- Extracted shared Linq webhook verification/parsing into `packages/inboxd/src/connectors/linq/webhook.ts` and rewired the local connector to reuse it.
- Restored the shared hosted JSON/body helpers through `apps/web/src/lib/http.ts` so device-sync and Linq routes share one request utility layer.
- Updated architecture/runtime docs and hosted app docs to describe `apps/web` as the broader hosted integration control plane.

## Verification Notes

- Passed: `pnpm --dir apps/web typecheck`
- Passed: `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage --maxWorkers 1 apps/web/test/linq-control-plane.test.ts apps/web/test/linq-webhook-route.test.ts`
- Passed: `pnpm exec vitest run --config packages/inboxd/vitest.config.ts --no-coverage --maxWorkers 1 packages/inboxd/test/linq-webhook.test.ts packages/inboxd/test/linq-connector.test.ts`
- Passed: `pnpm typecheck`
- Failed outside this lane: `pnpm test`
- Failed outside this lane after hosted/web + Linq segments passed: `pnpm test:coverage`
Completed: 2026-03-28
