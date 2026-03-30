# 2026-03-30 Greenfield Legacy Removal Audit

## Goal

- Land the supplied greenfield legacy-removal audit patch cleanly against the current worktree.
- Remove compatibility branches that are now audit-classified as dead in greenfield-only state while preserving current active trust-boundary protections.
- Finish the residual assistant-session `providerBinding` hard cut after the user explicitly asked to continue and remove it in the same turn.

## Scope

- `agent-docs/exec-plans/active/2026-03-30-greenfield-legacy-removal-audit.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `apps/cloudflare/src/outbox-delivery-journal.ts`
- `apps/cloudflare/test/index.test.ts`
- `apps/cloudflare/test/outbox-delivery-journal.test.ts`
- `apps/web/src/lib/linq/prisma-store.ts`
- `apps/web/test/prisma-store-linq-binding.test.ts`
- `packages/cli/src/assistant-cli-contracts.ts`
- `packages/cli/src/assistant/provider-state.ts`
- `packages/cli/src/assistant/store/persistence.ts`
- `packages/cli/src/assistant/doctor-security.ts`
- `packages/cli/test/assistant-state.test.ts`
- `packages/cli/test/assistant-daemon-client.test.ts`
- `packages/cli/test/assistant-runtime.test.ts`
- `packages/cli/test/assistant-service.test.ts`
- `packages/cli/test/inbox-model-harness.test.ts`
- `packages/cli/test/incur-smoke.test.ts`
- `packages/hosted-execution/src/env.ts`
- `docs/legacy-removal-audit-2026-03-30.md`

## Findings

- The supplied patch hard-cuts legacy effect-key record payload support in the hosted side-effect journal and keeps only alias-backed effect-key lookups plus canonical fingerprint-key records.
- The supplied patch also removes hosted Linq recipient-phone compatibility scans and duplicate-collapse helpers in favor of canonical unique lookup/update behavior only.
- One remaining env compatibility alias (`HOSTED_SHARE_BASE_URL`) is only read in the shared env helper and is no longer part of the active documented contract surface.
- The user later explicitly asked to remove the residual assistant-session flat-field fallback into `providerBinding` in this turn, so the work widened from planning-only to implementation for that cleanup.

## Constraints

- Treat the supplied patch as intent, not authority to overwrite current files blindly.
- Preserve overlapping hosted/cloudflare/web work already in flight.
- Keep this scoped to the audit-approved legacy removals, the explicit `providerBinding` follow-up removal, and direct regressions only.
- Skip the repo's spawned completion-workflow audit agents for this lane because the user explicitly told me not to run them.

## Plan

1. Register the lane in the coordination ledger and verify the current state of every touched file.
2. Land the Cloudflare journal hard-cut, the hosted Linq canonical-only behavior, and the shared hosted-share env alias removal.
3. Update or replace the directly affected tests and add the audit note doc.
4. Remove the assistant-session flat-field `providerBinding` fallback after updating the remaining builders, persistence helpers, and CLI tests to the canonical nested shape.
5. Run focused verification for touched packages/apps plus the required repo commands, then close and commit the scoped diff.

## Verification

- Passed: `pnpm --dir apps/cloudflare typecheck`
- Passed: `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/outbox-delivery-journal.test.ts apps/cloudflare/test/index.test.ts --no-coverage`
- Passed: `pnpm --dir apps/web typecheck`
- Passed: `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/prisma-store-linq-binding.test.ts --no-coverage`
- Passed: `pnpm --dir packages/hosted-execution typecheck`
- Passed: `pnpm --dir packages/cli typecheck`
- Passed: `pnpm exec vitest run packages/cli/test/assistant-state.test.ts packages/cli/test/assistant-service.test.ts packages/cli/test/assistant-runtime.test.ts packages/cli/test/assistant-daemon-client.test.ts packages/cli/test/inbox-model-harness.test.ts --no-coverage --maxWorkers 1`
- Passed: `pnpm --dir packages/cli test`
- Passed: `pnpm typecheck`
- Passed: `pnpm test`
- Passed: `pnpm test:coverage`

## Outcome

- Landed the supplied audit patch cleanly against the live tree instead of applying it blindly.
- Hard-cut hosted side-effect journal reads to canonical alias-backed records, hard-cut hosted Linq phone binding reads and writes to canonical unique lookup behavior, and removed the dead hosted-share base URL env alias.
- Completed the requested assistant-session follow-up in the same turn by removing the flat-field `providerBinding` fallback from parsing/normalization/persistence and updating the remaining CLI tests and builders to the canonical nested shape.

Status: completed
Updated: 2026-03-30
Completed: 2026-03-30
Completed: 2026-03-30
