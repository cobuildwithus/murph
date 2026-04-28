# Share Packs Greenfield Delete

## Goal

Delete the share-pack feature as a greenfield hard cut: no hosted share-link creation, no share-pack payload storage, no `vault.share.accepted` mailbox import, no portable share-pack contract, and no assistant tool that creates share links.

Success means production code no longer has a share-pack import/export path, hosted runtime no longer fetches or records share imports, hosted web no longer accepts or displays share links, and residue scans find only historical release notes or completed-plan references.

## Assumptions

- This is a full deletion, not a compatibility migration.
- Existing hosted share links, encrypted share payload rows, and pending share-import mailbox work may stop working.
- Greenfield DB posture is required for the default plan: rewrite the initial hosted-web Prisma migration and clear/reset existing hosted mailbox/share rows rather than preserving old share-link behavior.
- If this must run against a deployed persistent DB, first convert the DB steps into explicit cleanup/drop migrations and document the retained legacy-state behavior before deleting parsers.
- Do not replace this with another bundle/import mechanism in the same change.
- Preserve unrelated hosted mailbox, vault-sync import, device-sync, onboarding, billing, retention, and conversation-message behavior.

## Current Logic Map

- Contracts define the portable bundle shape inside the broader shared upsert-schema file:
  - `packages/contracts/src/constants.ts`
  - `packages/contracts/src/shares.ts`
- Core owns local vault export/import:
  - `packages/core/src/shares.ts`
  - `packages/core/src/index.ts`
- Assistant hosted tools create packs and call an injected hosted share issuer:
  - `packages/assistant-engine/src/assistant-cli-tools/definitions/outward-side-effects.ts`
  - `packages/assistant-engine/src/assistant/execution-context.ts`
  - `packages/assistant-engine/src/model-harness/capabilities.ts`
  - reverse-dependent coverage in `packages/cli/test/inbox-model-harness.test.ts`
- Hosted web owns link metadata, encrypted payload rows, public routes, internal runtime callbacks, retention cleanup, and UI:
  - `apps/web/src/lib/hosted-share/**`
  - `apps/web/src/components/hosted-share/**`
  - `apps/web/app/share/[shareCode]/page.tsx`
  - `apps/web/app/api/hosted-share/**`
  - `apps/web/app/api/internal/hosted-execution/share/**`
  - `apps/web/app/join/[inviteCode]/**`
  - `apps/web/src/components/hosted-onboarding/**`
  - `apps/web/src/lib/hosted-onboarding/{billing,billing-service}.ts`
  - `apps/web/app/api/hosted-onboarding/billing/checkout/route.ts`
  - `apps/web/src/lib/hosted-retention/cleanup.ts`
  - `apps/web/prisma/schema.prisma`
  - `apps/web/prisma/migrations/**`
- Hosted execution shared contracts expose the wake and runtime callback contracts:
  - `packages/hosted-execution/src/contracts.ts`
  - `packages/hosted-execution/src/builders.ts`
  - `packages/hosted-execution/src/parsers.ts`
  - `packages/hosted-execution/src/runtime-control.ts`
  - `packages/hosted-execution/src/parsers/runtime-control.ts`
  - `packages/hosted-execution/src/routes.ts`
  - `packages/hosted-execution/package.json`
- Assistant runtime hydrates the pack from web, imports it into the restored vault, persists pending receipt state, and records the result after checkpoint:
  - `packages/assistant-runtime/src/hosted-runtime/events/share.ts`
  - `packages/assistant-runtime/src/hosted-runtime/events.ts`
  - `packages/assistant-runtime/src/hosted-runtime/system-mailbox.ts`
  - `packages/assistant-runtime/src/hosted-runtime/platform.ts`
  - `packages/assistant-runtime/src/hosted-runtime/models.ts`
  - `packages/assistant-runtime/src/hosted-runtime/mailbox-routing.ts`
- Cloudflare exposes the runtime share port over the hosted web-control transport:
  - `apps/cloudflare/src/runtime-platform.ts`
  - `apps/cloudflare/src/runner-outbound/shared-web-control-policy.ts`

## Deletion Plan

1. Remove the assistant share-link creation surface.
   - Delete `vault.share.createLink` from outward side-effect tool definitions.
   - Remove `buildSharePackFromVault` imports from assistant-engine.
   - Remove `AssistantHostedShareLink`, `AssistantHostedShareLinkRequest`, and `issueShareLink` from assistant execution context types and normalization.
   - Remove the `vault.share.createLink` provenance branch from model-harness capabilities while preserving `murph.device.connect`.
   - Update assistant-engine tool catalog/capability/runtime tests.
   - Update `packages/cli/test/inbox-model-harness.test.ts`, which injects `issueShareLink` and positively covers `vault.share.createLink` through the default assistant tool catalog.

2. Remove the hosted web share product surface.
   - Delete `apps/web/src/lib/hosted-share/**`.
   - Delete `apps/web/src/components/hosted-share/**`.
   - Delete the public share page under `apps/web/app/share/[shareCode]/`.
   - Delete hosted share APIs under `apps/web/app/api/hosted-share/**`.
   - Delete internal hosted execution share payload/import callback routes under `apps/web/app/api/internal/hosted-execution/share/**`.
   - Treat deleted routes as absent 404s by default. Do not add compatibility tombstone routes unless the product decision changes.
   - Update route metadata and route tests including `apps/web/test/route-metadata-pages.test.ts`, `apps/web/test/hosted-execution-routes.test.ts`, any hosted-execution internal route tests, and all `apps/web/test/hosted-share-*.test.ts`.

3. Remove join/onboarding share query plumbing.
   - Remove `share` query parsing and share page-data lookup from `apps/web/app/join/[inviteCode]/page.tsx`.
   - Remove `shareCode`, `sharePreview`, `JoinInviteShareImportState`, accept/status polling, and pending action `"share"` from:
     - `apps/web/src/components/hosted-onboarding/join-invite-client.tsx`
     - `apps/web/src/components/hosted-onboarding/use-join-invite-share-import.ts`
     - `apps/web/src/components/hosted-onboarding/join-invite-state.ts`
     - `apps/web/src/components/hosted-onboarding/join-invite-sections.tsx`
     - `apps/web/src/components/hosted-onboarding/join-invite-stage-panels.tsx`
     - `apps/web/src/components/hosted-onboarding/join-invite-copy.ts`
   - Update `apps/web/test/join-page.test.ts`, `apps/web/test/join-invite-client.test.ts`, and related join preview tests.
   - Add focused proof that `?share=` is ignored or stripped without calling hosted-share APIs.

4. Remove billing and checkout share propagation.
   - Remove `shareCode` from:
     - `apps/web/src/lib/hosted-onboarding/billing.ts`
     - `apps/web/src/lib/hosted-onboarding/billing-service.ts`
     - `apps/web/app/api/hosted-onboarding/billing/checkout/route.ts`
     - `apps/web/src/components/hosted-onboarding/client-api.ts`
     - `apps/web/app/join/[inviteCode]/success/page.tsx`
     - `apps/web/app/join/[inviteCode]/cancel/page.tsx`
     - `apps/web/src/components/hosted-onboarding/join-invite-success-client.tsx`
   - Remove `shareCode` from hosted billing idempotency key construction and onboarding logging fields such as `shareCodeProvided`.
   - Update billing, checkout route, onboarding logging, success page, and cancel page tests.

5. Remove hosted retention share cleanup.
   - Remove `deleteExpiredSharePayloads` and `expiredSharePayloadsDeleted` from `apps/web/src/lib/hosted-retention/cleanup.ts`.
   - Update `apps/web/test/hosted-retention-cleanup.test.ts` and `apps/web/test/hosted-retention-cron-route.test.ts`.
   - Keep unrelated retention cleanup behavior intact.

6. Remove hosted web persistence and legacy hosted mailbox data.
   - Remove `HostedShareLink` and `HostedSharePayload` from `apps/web/prisma/schema.prisma`.
   - Default greenfield path: remove the `hosted_share_link` and `hosted_share_payload` DDL, indexes, and FK from `apps/web/prisma/migrations/2026040600_init/migration.sql`.
   - If a deployed DB must be preserved, replace the greenfield rewrite with a dedicated migration that:
     - deletes or tombstones `hosted_mailbox_item` rows whose kind is `vault.share.accepted` plus any related payload rows before parsers reject them;
     - drops `hosted_share_payload` before `hosted_share_link`, or documents `CASCADE`.
   - Update `apps/web/test/hosted-onboarding-privacy-foundation-migration.test.ts`.
   - Regenerate Prisma client after schema/migration edits.

7. Remove hosted execution share contracts.
   - Remove `vault.share.accepted` from hosted event, wake, and mailbox kind arrays.
   - Delete share reference/event interfaces and `HostedExecutionRunnerSharePack`.
   - Delete `buildHostedExecutionVaultShareAcceptedWake`.
   - Delete `HOSTED_RUNTIME_SHARE_IMPORT_PATH`, `buildHostedRuntimeSharePayloadPath`, share payload fetch/import request and response types, constants, and parsers.
   - Treat the route exports as a public API break and update `packages/hosted-execution/test/hosted-execution.test.ts`.
   - Update hosted-execution builder/parser/runtime-control tests and fixtures.
   - Re-scan `packages/hosted-execution/package.json`: remove `@murphai/core` if it becomes share-only, remove `@murphai/contracts` if no hosted-execution code still imports it, update `pnpm-lock.yaml`, and update release/bundle expectation tests such as `packages/cli/test/release-script-coverage-audit.test.ts`.

8. Remove assistant-runtime share import execution and stale-state handling.
   - Delete `packages/assistant-runtime/src/hosted-runtime/events/share.ts`.
   - Remove the `vault.share.accepted` branch from hosted mailbox event execution.
   - Remove `sharePack`, `shareImportResult`, `shareImportTitle`, `vault-share-accepted`, `import-vault-share`, and `share-import` pending-record handling from runtime models and system mailbox state handling.
   - Remove `sharePort` from `HostedRuntimePlatform`.
   - Decide and encode stale workspace behavior for serialized old state containing `routeAction: "import-vault-share"` or `postCheckpointRecord.kind: "share-import"`:
     - greenfield/reset posture may fail closed with a clear error, or
     - runtime may drop those legacy pending records with a redacted warning.
   - Add tests in `packages/assistant-runtime/test/hosted-runtime-system-mailbox.test.ts` and routing/event tests for the chosen stale-state behavior. Do not leave stale state silently calling a removed `sharePort`.

9. Remove Cloudflare share transport.
   - Delete `createHostedWebSharePort()` from `apps/cloudflare/src/runtime-platform.ts`.
   - Stop injecting `sharePort` into the hosted runtime platform.
   - Remove share payload/import route display and log-redaction branches, including the `createHostedWebControlLogPath` share path case.
   - Remove `HOSTED_RUNTIME_SHARE_PAYLOAD_PATH`, `HOSTED_RUNTIME_SHARE_IMPORT_PATH`, GET payload allowlist, and POST import allowlist entries from `apps/cloudflare/src/runner-outbound/shared-web-control-policy.ts`.
   - Replace positive share callback tests in `apps/cloudflare/test/runner-platform.test.ts` and `apps/cloudflare/test/runner-outbound.test.ts` with rejection coverage for the deleted callback routes.

10. Remove core share-pack import/export.
   - Delete `packages/core/src/shares.ts`.
   - Remove the root export from `packages/core/src/index.ts`.
   - Remove `packages/core/test/share-pack.test.ts`.
   - Confirm no other core, CLI, assistant, or hosted runtime code imports `buildSharePackFromVault` or `importSharePackIntoVault`.

11. Remove only the contract share-pack schema, not the whole shared schema file.
   - Keep `packages/contracts/src/shares.ts`; it also owns non-share-pack upsert payload schemas used by `bank-entities.ts`, `health-entities.ts`, core, and query code.
   - Delete only `sharePack*` payload/entity/pack schemas, inferred `SharePack*` types, `CONTRACT_SCHEMA_VERSION.sharePack`, and now-unused share-pack-only ref helpers.
   - Remove share-pack contract coverage from `packages/contracts/test/memory-shares-coverage.test.ts`.
   - Add or update public-entrypoint coverage so `sharePackSchema`/`SharePack` are no longer exposed from the root public surface.
   - Confirm `packages/contracts/generated/**` has no stale share-pack artifacts. Share-pack schemas may not currently be generated, but the residue scan should prove that.

12. Clean durable docs, legal docs, prompts, and package-boundary guards.
   - Update current architecture/runtime docs:
     - `ARCHITECTURE.md`
     - `docs/architecture.md`
     - `apps/web/README.md`
     - `apps/cloudflare/README.md`
     - `packages/assistant-runtime/README.md`
     - `agent-docs/operations/verification-and-runtime.md`
     - `agent-docs/references/hosted-runtime-protocol.md`
     - `agent-docs/references/testing-ci-map.md`
   - Review legal docs and update only if they describe share links or payload retention:
     - `apps/web/legal/terms-of-service.md`
     - `apps/web/legal/privacy-policy.md`
   - Update live prompts/guards:
     - `agent-docs/prompts/seam-audits/29-web-browser-vault-sync.md`
     - `scripts/workspace-boundaries/import-policy-rules.mjs`
   - Do not edit historical release notes or completed execution plans except when a live guard/test reads them as current truth.

## Verification Plan

- Run residue scans and classify remaining matches:
  - `rg -n "sharePack|SharePack|share-pack|murph\\.share-pack|vault\\.share\\.accepted|HostedExecutionRunnerSharePack|HostedShare|hosted-share|hosted_share_|HOSTED_RUNTIME_SHARE|sharePort|vault\\.share\\.createLink|import-vault-share|vault-share-accepted|share-import|issueShareLink|buildHostedRuntimeSharePayloadPath|HOSTED_RUNTIME_SHARE_IMPORT_PATH" packages apps config scripts docs agent-docs --glob '!agent-docs/exec-plans/completed/**' --glob '!packages/cli/release-notes/**'`
  - `rg -n "shareCode|sharePreview|shareImport|share-import|shareCodeProvided|expiredSharePayloadsDeleted|deleteExpiredSharePayloads|hostedShare|HostedShare|hosted_share_" apps/web packages/assistant-runtime packages/hosted-execution apps/cloudflare packages/assistant-engine packages/core packages/contracts scripts`
- Run generated/schema checks:
  - `pnpm --dir apps/web prisma:generate`
  - `pnpm --dir packages/contracts generate`
  - any package-owned schema/artifact check exposed by `packages/contracts`.
- Run owner coverage:
  - `pnpm --dir packages/contracts test:coverage`
  - `pnpm --dir packages/core test:coverage`
  - `pnpm --dir packages/assistant-engine test:coverage`
  - `pnpm --dir packages/hosted-execution test:coverage`
  - `pnpm --dir packages/assistant-runtime test:coverage`
  - focused CLI reverse-dependent proof for `packages/cli/test/inbox-model-harness.test.ts`
  - `pnpm --dir apps/web verify`
  - `pnpm --dir apps/cloudflare verify`
- Run repo-level gates unless a known unrelated branch failure forces documented scoped verification:
  - `pnpm typecheck`
  - `pnpm verify:acceptance`
  - doc drift checks if available in the current package scripts.
- If package manifests or lockfile change:
  - run the repo dependency guard/dependency verification command used by current scripts;
  - check package bundle/release expectation tests.
- Run required completion audits for the high-risk cross-cutting change:
  - `security-privacy-review`
  - `coverage-write`
  - `frontend-review`
  - `task-finish-review`

## Risks

- Hosted web mailbox rows may contain `vault.share.accepted`; deleting the parser before cleaning those rows can make mailbox fetch fail before runtime can quarantine them.
- Hosted assistant workspace snapshots may contain `postCheckpointRecord.kind: "share-import"` or pending `vault.share.accepted` work; deleting parsers naively can make old snapshots fail to load.
- Prisma handling depends on deployment posture. Rewriting the initial migration is correct only when the DB can be reset or the migration has not been applied to persistent production data.
- Join-invite checkout/success/cancel flows currently preserve an optional `share` query; removing it must not regress ordinary invite billing.
- Contract deletion can break public package consumers if share-pack types were externally consumed. Treat this as a breaking release and do not leave compatibility shims.
- Removing hosted-execution dependencies may affect publish bundle contents and release-manifest tests.

## Completion Criteria

- No production imports or public APIs reference share packs.
- No hosted web route accepts, displays, fetches, stores, finalizes, or cleans up share payloads.
- Hosted runtime and Cloudflare have no share port, share import receipt path, or share callback allowlist.
- Old share mailbox rows and old assistant-runtime share pending state have a documented reset, migration, fail-closed, or drop behavior with tests.
- Core no longer exports share-pack import/export helpers.
- Contracts no longer expose share-pack schemas/types/schema version while preserving non-share upsert schemas.
- Docs describe hosted execution without share-pack exceptions.
- Residue scan is clean except historical records or intentional negative assertions.

## Completion Notes

- Implemented as a greenfield hard cut across hosted web, hosted-execution, assistant-runtime, Cloudflare, assistant tooling, core, contracts, docs, legal markdown/PDFs, and coupled tests.
- Residue scans only found active/historical planning text, negative assertions, and explicit assistant-runtime legacy share-import fail-closed handling.
- Focused owner verification passed for contracts, core, assistant-engine, hosted-execution, assistant-runtime, hosted web, hosted Cloudflare, and the CLI reverse-dependent inbox harness.
- Required security/privacy, frontend, coverage-write, and final task-finish review subagents found no blockers.
- `pnpm typecheck` and `pnpm verify:acceptance` both reached unrelated active `packages/setup-cli` provider-preset null/undefined typecheck failure after the share-pack-owned surfaces had passed.
Status: completed
Updated: 2026-04-28
Completed: 2026-04-28
