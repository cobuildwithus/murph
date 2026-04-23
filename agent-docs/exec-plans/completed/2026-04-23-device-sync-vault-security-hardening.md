# Fence stale hosted device-sync hydration, preserve durable identity bindings, and minimize vault-sync conflict retention

Status: completed
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Close the highest-value security and persistence gaps from the latest audit without widening beyond the directly coupled hosted/local device-sync seams and vault-sync conflict staging behavior.

## Success criteria

- Older hosted device-sync snapshots cannot overwrite newer locally observed connection state or token state during hosted-to-local hydration.
- Hosted token persistence no longer clears `externalAccountIdEncrypted` unless a caller explicitly requests that binding be cleared, and tokenless-to-retokenized flows keep the same durable provider identity.
- Vault-sync conflict handling no longer persists full conflicting payloads under `raw/sync-imports/**` by default; conflict manifests keep only bounded metadata needed for operator diagnosis.
- Focused regression tests cover each fix and the required verification and audit passes complete for this high-risk slice.

## Scope

- In scope:
- `packages/assistant-runtime/src/hosted-device-sync-runtime.ts`
- `packages/device-syncd/src/store.ts`
- focused `packages/{assistant-runtime,device-syncd}/test/**`
- `apps/web/src/lib/device-sync/{hosted-runtime-authority.ts,internal-runtime.ts,prisma-store/connections.ts}`
- focused `apps/web/test/device-sync-hosted-runtime-authority.test.ts` and any directly coupled hosted device-sync store/runtime tests
- `packages/core/src/vault-sync.ts`
- focused `packages/core/test/vault-sync.test.ts`
- this active plan and the coordination-ledger row for the lane
- Out of scope:
- broader hosted/local device-sync identity redesign around stable hosted connection ids
- schema migrations or new durable tables
- unrelated Cloudflare, onboarding, or frontend work

## Constraints

- Technical constraints:
- Keep hosted `apps/web` as the durable control-plane owner and local `device-syncd` as the local runtime owner.
- Preserve the existing `(provider, externalAccountId)` local uniqueness contract while preventing hosted writes from erasing the durable external-account binding.
- Keep vault-sync merge diagnostics operator-usable without duplicating sensitive canonical payloads into a second long-lived raw namespace.
- Product/process constraints:
- Preserve unrelated dirty-tree edits.
- Treat this as a high-risk cross-cutting change: scoped plan, ledger row, truthful scoped verification, required `coverage-write`, and required `task-finish-review`.

## Risks and mitigations

1. Risk: stale hosted snapshots could still partially regress local state through fallback fields or clear-token paths.
   Mitigation: fence connection-state writes and token writes separately on raw hosted observation data, and add regression tests for stale replay paths.
2. Risk: preserving external account bindings by default could block a legitimate explicit-clear flow later.
   Mitigation: make preservation the default behavior and leave an explicit clear-binding seam in the persistence API rather than overloading `null`.
3. Risk: removing preserved conflict payloads could leave operators without enough diagnosis detail.
   Mitigation: keep per-conflict manifest metadata, hashes, reasons, and bounded preserved-path identifiers while dropping full payload retention by default.

## Tasks

1. Register the lane and confirm the exact stale-write, identity-fork, and conflict-retention failure modes.
2. Implement hosted-to-local hydration fences in `assistant-runtime` and `device-syncd`, with focused replay regressions.
3. Implement hosted external-account binding preservation in `apps/web`, with a tokenless-to-retokenized regression.
4. Minimize vault-sync conflict retention to manifest metadata only, and update focused merge tests.
5. Run scoped verification and the required audit passes, fix any findings, and prepare the narrowest safe commit path.

## Decisions

- Hosted/local replay fencing now uses monotonic `local_connection_revision` and `local_token_revision` counters, with matching hosted-observed revision watermarks, instead of relying on wall-clock ordering.
- Legacy stores that migrate from the pre-revision observation schema conservatively seed local revision counters when the legacy connection or credential timestamps diverge from the last hosted watermark, so the first post-upgrade replay cannot silently roll back newer local state in the common migrated cases visible from the old schema.
- Hosted runtime sync state now keeps the accepted post-fence connection and token baseline from the hydrated local account while preserving the raw hosted local-state baseline, so same-wake reconcile cannot build token/connection updates from a rejected hosted snapshot but can still push forward monotonic local progress that the hosted snapshot omitted.
- Hosted token persistence preserves the durable encrypted external-account binding unless the caller explicitly sets the clear-binding seam.
- Vault-sync conflict manifests now retain bounded metadata only; conflicting raw payload copies are no longer written under `raw/sync-imports/**`.

## Verification

- Commands to run:
- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff packages/assistant-runtime/src/hosted-device-sync-runtime.ts packages/assistant-runtime/test/hosted-device-sync-runtime.test.ts packages/device-syncd/src/store.ts packages/device-syncd/test/store.test.ts apps/web/src/lib/device-sync/hosted-runtime-authority.ts apps/web/src/lib/device-sync/internal-runtime.ts apps/web/src/lib/device-sync/prisma-store/connections.ts apps/web/test/device-sync-hosted-runtime-authority.test.ts packages/core/src/vault-sync.ts packages/core/test/vault-sync.test.ts`
- `pnpm test:smoke`
- Expected outcomes:
- Stale hosted replays stop mutating newer local device-sync state, hosted token writes preserve durable provider identity by default, and vault-sync conflicts stop writing full conflicting payload copies under `raw/sync-imports/**`.
- Actual outcomes:
- `pnpm --dir packages/device-syncd exec vitest run --config vitest.config.ts test/store.test.ts test/service.test.ts --no-coverage` passed.
- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts test/hosted-device-sync-runtime.test.ts --no-coverage` passed.
- `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts test/device-sync-hosted-runtime-authority.test.ts test/prisma-store-oauth-connection.test.ts --no-coverage` passed.
- `pnpm --dir packages/core exec vitest run --config vitest.config.ts test/vault-sync.test.ts test/high-value-seam-regressions.test.ts --no-coverage` passed.
- `pnpm --dir packages/device-syncd test:coverage` passed after adding legacy-schema migration coverage for the new revision backfill.
- `pnpm --dir packages/assistant-runtime test:coverage` still fails for unrelated pre-existing coverage gaps in `src/hosted-runtime/events/linq.ts` and `src/hosted-runtime/message-cleanup.ts`; the touched files clear coverage locally.
- `pnpm --dir apps/web lint` passed with 21 pre-existing warnings and no errors.
- `pnpm test:smoke` passed.
- `pnpm typecheck` passed.
- `git diff --check -- <task paths>` passed.
- `bash scripts/workspace-verify.sh test:diff ...` still fails for the unrelated pre-existing `packages/assistant-engine/test/assistant-wrapper-exports.test.ts` expectation that `executeCodexPrompt` is exported.
Completed: 2026-04-23
