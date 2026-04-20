# Privacy/data-minimization audit for hosted ingress, inbox, runtime, and share retention

Status: completed
Created: 2026-04-20
Updated: 2026-04-20

## Goal

- Verify whether the seven reported privacy/data-minimization findings are already addressed in the current workspace.
- Land only the still-missing reductions so the greenfield shape keeps the narrowest durable retention needed for product and recovery behavior.

## Success criteria

- Each reported finding is classified as already landed, not applicable, or fixed in this turn with direct file evidence.
- Any code changes minimize durable retention while preserving the owning product, recovery, and trust-boundary invariants.
- Overlapping dirty-tree work is preserved; this task does not revert or overwrite in-flight hosted-runtime, Cloudflare, or onboarding changes.

## Scope

- `apps/web/prisma/schema.prisma`
- `apps/web/src/lib/hosted-ingress/**`
- `apps/web/src/lib/hosted-run/**`
- `apps/web/src/lib/hosted-share/**`
- directly coupled `apps/web/test/**` only if required
- `apps/cloudflare/src/hosted-email/**`
- `apps/cloudflare/src/user-runner/**`
- `apps/cloudflare/r2-bundles-lifecycle.json`
- directly coupled `apps/cloudflare/test/**` only if required
- `packages/assistant-runtime/src/hosted-runtime/**`
- directly coupled `packages/assistant-runtime/test/**` only if required
- `packages/inboxd/src/**`
- `packages/messaging-ingress/src/**`
- directly coupled inbox tests only if required
- `packages/assistant-engine/src/assistant/{store,persistence,provider-turn-runner,turn-finalizer,cron,outbox}/**`
- directly coupled `packages/assistant-engine/test/**` only if required
- `packages/device-syncd/src/**`
- directly coupled `packages/device-syncd/test/**` only if required

## Constraints

- Preserve overlapping dirty-tree edits, especially the active hosted-runtime, hosted-email, wake-to-run, and security-followup lanes.
- Prefer one canonical source of truth plus rebuildable projections over parallel durable copies.
- Keep behavior fail-closed on retention or cleanup paths; do not silently weaken product, auth, or recovery invariants.
- If a candidate fix requires a broad architectural change rather than a narrow reduction, stop at classification and document the gap instead of forcing a risky rewrite.

## Verification

- passed: `pnpm typecheck`
- passed: `bash scripts/workspace-verify.sh test:diff apps/web/prisma/schema.prisma apps/web/src/lib/hosted-ingress apps/web/src/lib/hosted-run apps/web/src/lib/hosted-share apps/web/test apps/cloudflare/src/hosted-email apps/cloudflare/src/user-runner apps/cloudflare/test apps/cloudflare/r2-bundles-lifecycle.json packages/assistant-runtime/src/hosted-runtime packages/assistant-runtime/test packages/inboxd/src packages/inboxd/test packages/messaging-ingress/src packages/messaging-ingress/test packages/assistant-engine/src/assistant packages/assistant-engine/test packages/device-syncd/src packages/device-syncd/test`
- passed: `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-browser-vault.test.ts`
- passed: `pnpm --dir packages/inboxd exec vitest run test/inboxd-runtime-kernel-coverage.test.ts`
- passed: `pnpm --dir packages/assistant-engine test -- test/assistant-store-persistence.test.ts test/assistant-outbox-runtime.test.ts test/assistant-cron-schedule-store.test.ts test/assistant-runtime-thresholds.test.ts`
- passed: `pnpm --dir packages/device-syncd exec vitest run test/provider-label.test.ts test/strava-provider.test.ts test/oura-provider.test.ts test/whoop-provider.test.ts`
- passed: `pnpm --dir apps/web test -- test/hosted-run-store.test.ts`
- passed: `pnpm --dir apps/cloudflare test -- test/hosted-email-worker-ingress.test.ts`
- passed: `noglob git diff --check -- apps/cloudflare/DEPLOY.md apps/cloudflare/README.md apps/cloudflare/r2-bundles-lifecycle.json apps/cloudflare/src/browser-vault-store.ts apps/cloudflare/src/hosted-email.ts apps/cloudflare/src/hosted-email/worker-ingress.ts apps/cloudflare/src/user-runner/runner-run-processor.ts apps/cloudflare/test/browser-vault-store.test.ts apps/cloudflare/test/hosted-email-worker-ingress.test.ts apps/cloudflare/test/r2-lifecycle.test.ts apps/cloudflare/test/runner-run-processor.test.ts apps/web/app/api/internal/hosted-execution/share/[shareId]/payload/route.ts apps/web/src/lib/hosted-run/store.ts apps/web/src/lib/hosted-share/acceptance-service.ts apps/web/src/lib/hosted-share/link-service.ts apps/web/src/lib/hosted-share/shared-acceptance.ts apps/web/src/lib/hosted-share/shared-payload.ts apps/web/src/lib/hosted-share/shared.ts apps/web/test/hosted-run-store.test.ts apps/web/test/hosted-share-acceptance-lifecycle.test.ts apps/web/test/hosted-share-claim-state.test.ts apps/web/test/hosted-share-finalize.test.ts apps/web/test/hosted-share-payload-route.test.ts apps/web/test/hosted-share-service.test.ts packages/assistant-engine/src/assistant/cron/store.ts packages/assistant-engine/src/assistant/outbox/store.ts packages/assistant-engine/src/assistant/runtime-budgets.ts packages/assistant-engine/src/assistant/store/persistence.ts packages/assistant-engine/test/assistant-cron-schedule-store.test.ts packages/assistant-engine/test/assistant-outbox-runtime.test.ts packages/assistant-engine/test/assistant-runtime-thresholds.test.ts packages/assistant-engine/test/assistant-store-persistence.test.ts packages/assistant-runtime/src/hosted-runtime/browser-vault.ts packages/assistant-runtime/test/hosted-runtime-browser-vault.test.ts packages/device-syncd/src/provider-label.ts packages/device-syncd/src/providers/oura.ts packages/device-syncd/src/providers/strava.ts packages/device-syncd/src/providers/whoop.ts packages/device-syncd/test/oura-provider.test.ts packages/device-syncd/test/provider-label.test.ts packages/device-syncd/test/strava-provider.test.ts packages/device-syncd/test/whoop-provider.test.ts packages/inboxd/src/indexing/persist/canonical-records.ts packages/inboxd/test/inboxd-runtime-kernel-coverage.test.ts`

## Landed status by finding

1. Hosted ingress payload retention: fixed in this turn. Terminal hosted-run finalization now scrubs inline payload ciphertext, clears payload refs, and deletes spilled payload rows after commit/finalize.
2. Hosted raw email retention and logging: fixed in this turn. Added raw-email cleanup on permanent append failures, a lifecycle backstop for `hosted-email/messages/**`, and preserved the existing hosted-email log-redaction lane. Final review tightened cleanup so transient `5xx`/timeout/rate-limit append failures keep the blob for retry.
3. Browser-vault hosted duplication: partially fixed in this turn. Stored browser-vault exports now reduce to an allowlisted dashboard-facing entity subset with preview-sized journal and experiment text, and stale sidecars are deleted when no snapshot is returned.
4. Inbox duplication: partly already landed, then tightened in this turn. The active canonical persist path was already centered on inbox capture records; this pass removed the dead generic event-note helper path so inbox text is not poised for broader timeline duplication.
5. Local assistant runtime transcript/outbox/cron retention: fixed in this turn. Replay data now trims to the replay window, terminal outbox payloads are reduced by age/count, and cron responses/history are bounded.
6. Device connection metadata minimization: fixed in this turn. Provider labels are opaque and Strava connect-time metadata no longer persists broad profile/location fields.
7. Hosted share payload retention: fixed in this turn. Share payload blobs are deleted on consumption/finalization/expiry and the internal payload route now fails closed once the payload is gone.

## Notes

- Several targeted files are already dirty from other active rows, so every proposed edit must first be checked against the current workspace and the owning active plan.
- The user explicitly asked for subagents to verify landed status and fix only the still-missing reductions; use separate scopes whenever the write sets do not overlap.
- Required review passes completed: `coverage-write` reported no findings; `task-finish-review` found two follow-ups that were fixed before close-out:
  - raw-email cleanup no longer treats transient append failures as definitive;
  - hosted-run `redactedJson` now stores sanitized structured payloads instead of raw values.
- Residual architectural gap: the hosted browser-vault path still stores canonical entities for an allowlisted subset rather than page-specific projections. This pass materially narrowed the retained copy without redesigning the dashboard data contract.
Completed: 2026-04-20
