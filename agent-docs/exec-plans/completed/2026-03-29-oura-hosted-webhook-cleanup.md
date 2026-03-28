# Oura Hosted Webhook Cleanup

## Goal

Fix the reviewed hosted Oura/device-sync issues without widening behavior beyond the requested simplifications:

- close hosted webhook traces when owner lookup fails after claim
- make hosted Oura webhook-subscription upkeep explicit global admin work instead of snapshot-local state
- share one GET webhook verification contract between local and hosted surfaces
- slim Oura webhook job payloads to the fields each executor actually reads while preserving delete provenance

## Success criteria

- Hosted accepted webhooks do not leave claimed traces stuck in `processing` when owner lookup fails.
- Hosted runtime snapshot upkeep makes the Oura/global-admin seam explicit and keeps request-scoped provider selection separate from snapshot assembly.
- Local and hosted webhook verification responses are driven by one shared helper/contract.
- Oura job payloads are kind-specific, hosted wake hints preserve only required fields, and delete-lane behavior stays intact.

## Scope

- `apps/web/src/lib/device-sync/{control-plane.ts,wake-service.ts,prisma-store.ts}`
- `apps/web/app/api/{device-sync/webhooks/[provider]/route.ts,internal/device-sync/runtime/snapshot/route.ts}`
- `apps/web/test/{agent-route.test.ts,device-sync-hosted-wake-dispatch.test.ts,hosted-device-sync-internal-routes.test.ts}`
- `packages/device-syncd/src/{http.ts,public-ingress.ts,providers/oura.ts,providers/oura-webhooks.ts}`
- `packages/device-syncd/test/{http.test.ts,oura-provider.test.ts,oura-webhooks.test.ts,public-ingress.test.ts}`
- coordination/verification metadata touched by this lane only

## Constraints

- Preserve the existing invariant that the durable hosted hook owns normal trace completion and public ingress must not double-complete it.
- Treat any shift from explicit trace completion to release-or-retry semantics as behavior-changing and out of scope.
- Preserve Oura delete-job provenance if `webhookPayload` is still needed by the executor/importer boundary.
- Read and preserve overlapping live edits in the hosted device-sync files; this lane is non-exclusive.

## Risks and mitigations

- Overlap with active hosted device-sync work: keep the diff narrow, read current file state first, and avoid unrelated refactors.
- Shared helper extraction could drift route semantics: keep the helper contract tiny and prove it from both local and hosted boundaries.
- Payload slimming could accidentally strip delete fallback data: add direct provider and hosted handoff assertions for delete jobs.

## Verification

- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Focused Vitest slices while iterating on the touched `apps/web` and `packages/device-syncd` tests
- Mandatory completion-workflow audit passes: `simplify`, `test-coverage-audit`, `task-finish-review`

## Completion notes

- Close this plan with `bash scripts/finish-task agent-docs/exec-plans/active/2026-03-29-oura-hosted-webhook-cleanup.md "<type(scope): summary>" <files...>` when the lane is done.

## Outcome

- Hosted webhook acceptance now closes claimed traces on the null-owner path instead of leaving them stuck in `processing`.
- Hosted runtime snapshot upkeep now exposes the global webhook-admin seam explicitly, with connection/provider selection separated from snapshot assembly.
- Local and hosted Oura verification routes now share one response helper contract.
- Oura webhook jobs now use kind-specific payloads, and hosted delete hints keep only the required delete fields.

## Verification results

- Passed: `pnpm exec vitest run --no-coverage packages/device-syncd/test/http.test.ts packages/device-syncd/test/oura-provider.test.ts packages/device-syncd/test/oura-webhooks.test.ts apps/web/test/agent-route.test.ts apps/web/test/device-sync-hosted-wake-dispatch.test.ts apps/web/test/hosted-device-sync-internal-routes.test.ts`
- Passed direct scenario: `pnpm exec tsx --eval '...'` confirmed the shared verification helper returns `{ challenge: "challenge-123" }` for a valid Oura verification request and throws the existing mismatch message for a wrong token.
- Blocked outside this lane: `pnpm typecheck` currently fails in `packages/contracts/scripts/verify.ts`; `pnpm test` and `pnpm test:coverage` currently fail on unrelated existing errors in `packages/assistant-runtime/src/hosted-runtime/events.ts` and `apps/web/src/lib/hosted-execution/hydration.ts`, plus one transient concurrent `next build` contention during the first `pnpm test` run.
Status: completed
Updated: 2026-03-29
Completed: 2026-03-29
