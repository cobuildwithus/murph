## Title

Fix the reproducible high-signal security and idempotency gaps from the review pass with minimal safe code changes and regression tests.

## Goal

Land the smallest safe fixes for the canonical JSONL import dedupe race and the hosted device-sync agent-session token exposure, while verifying the overlapping hosted-run log, hosted-email log, and runner-smoke follow-ups already in flight and only adjusting those files if a residual gap remains.

## Scope

- `packages/core/src/mutations.ts`
- focused `packages/core/test/**` for concurrent import dedupe regression coverage
- `apps/web/app/api/device-sync/agent/connections/[connectionId]/{export-token-bundle,refresh-token-bundle}/route.ts`
- `apps/web/src/lib/device-sync/{agent-session-service.ts,agent-session-token-bundle.ts}`
- focused `apps/web/test/{agent-session-service,prisma-store-agent-session}.test.ts`
- overlapping dirty security-followup files only if residual gaps remain after inspection:
  - `apps/web/app/api/internal/hosted-run/log/route.ts`
  - `apps/web/src/lib/hosted-run/store.ts`
  - `packages/hosted-execution/src/parsers/run-control.ts`
  - `apps/cloudflare/src/hosted-email/{routes.ts,worker-ingress.ts}`
  - `apps/cloudflare/src/web-control-plane-email-ingress.ts`
  - `apps/cloudflare/scripts/runner-docker-smoke.ts`
  - focused tests under those owners

## Constraints

- Preserve unrelated dirty-tree edits and active rows in `COORDINATION_LEDGER.md`.
- Do not widen into a large device-sync protocol redesign; prefer one-time bearer rotation, narrower export shapes, and explicit connection scoping if those satisfy the risk.
- Do not rewrite the canonical write-batch architecture; fix the append-plan timing at the narrowest safe seam that closes the race.
- Treat the existing `2026-04-20-thread-security-followups.md` lane as the primary owner of hosted-run/email/smoke edits and adjust on top of those files only when needed for the user-requested issue set.

## Verification

- planned: `pnpm typecheck`
- planned: `bash scripts/workspace-verify.sh test:diff packages/core/src/mutations.ts packages/core/test apps/web/app/api/device-sync/agent/connections/[connectionId]/export-token-bundle/route.ts apps/web/app/api/device-sync/agent/connections/[connectionId]/refresh-token-bundle/route.ts apps/web/src/lib/device-sync/agent-session-service.ts apps/web/src/lib/device-sync/agent-session-token-bundle.ts apps/web/test/agent-session-service.test.ts`
- planned: focused direct scenario proof for concurrent identical imports and single-use or rotated agent-session token export behavior
- planned: `git diff --check`

## Notes

- Local inspection already shows `buildJsonlAppendPlan()` currently runs before `runCanonicalWrite()` in `importSamples()` and `importDeviceBatch()`.
- Local inspection already shows agent export/refresh currently returns `refreshToken` and extends the same bearer window through `touchAgentSession()`.
- The overlapping hosted-run/email/smoke files are already dirty in the worktree under the separate security-followup plan; avoid redoing those changes unless the current file state still leaves a concrete gap.
Status: completed
Updated: 2026-04-20
Completed: 2026-04-20
