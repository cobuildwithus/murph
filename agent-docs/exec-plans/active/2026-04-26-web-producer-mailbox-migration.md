Goal (incl. success criteria):
- Migrate one coherent hosted web producer slice from hosted ingress/run events to encrypted HostedMailboxItem append for the greenfield hosted runtime cut.
- Keep product/control-plane mutation and mailbox append in one transaction where applicable.
- Keep Cloudflare nudge best-effort and after commit.
- Add focused tests for exactly one mailbox item, lane/kind/dedupe/schema, duplicate first-wins payload behavior, and no old run/adopt/finalize/source_cursor terms in the migrated path.

Constraints/Assumptions:
- Worker lanes do not commit; the parent integration lane owns any scoped commit
  after verification.
- Do not touch apps/cloudflare.
- Preserve unrelated dirty work and active hosted rows.
- No web-owned execution cursor, run adoption, committed seq, finalizeRequired, or turn-input peek/adopt in the new producer path.
- Payloads remain encrypted/opaque; no plaintext payloads/logs/docs.

Key decisions:
- Migrated the member-channel update producer slice first because it already runs inside product mutation transactions and feeds phone/email/Telegram channel changes through one shared producer helper.
- Added internal mailbox `payload_hash` metadata so duplicate dedupe keys can detect same-size payload drift without exposing plaintext payloads through the runtime mailbox contract.
- Kept sidecar payload refs opaque (`hosted-mailbox-payload:<item-id>`) while validating them back to the mailbox item id on fetch.

State:
- Vault-sync import readiness slice implemented and verified. Runner-side
  `vault.sync.import` mailbox handling is now covered by the runtime/Cloudflare
  workspace bridge lane, so this producer lane is no longer blocked on
  run-summary commit/finalize semantics.

Done:
- Read required repo docs and migration guide.
- Migrated `enqueueHostedMemberChannelsUpdatedTx` to append encrypted hosted mailbox envelopes instead of materializing hosted ingress events.
- Added mailbox envelope append ergonomics, encrypted payload storage, lane resolution, sidecar refs, and duplicate payload-hash conflict checks.
- Added focused store, producer, schema, and internal route tests.
- Ran required security/privacy, coverage, and task-finish review passes. Security finding for same-size payload drift was fixed; final review had no blocking findings.
- Verified focused Vitest, web typecheck, and diff whitespace checks.
- Migrated vault-sync upload completion from hosted ingress materialization to `vault.sync.import` mailbox append in the same transaction as payload/session updates.
- Removed vault-sync run-summary coupling; the later deletion wave removes the
  hosted-run routes entirely.
- Added signed vault-sync import-record route so runtime import completion marks the session terminal and deletes the encrypted side input without using run summaries.
- Added focused vault-sync producer and import-record route tests.
- Verified focused vault-sync Vitest, web typecheck, lint, diff whitespace, static legacy-summary scans, and privacy scans.

Now:
- Handoff only; parent integration owns final verification and commit.

Next:
- Remaining producers for later waves: conversation ingestion (Linq, Telegram, email), member activation and welcome notification, assistant notification request, device-sync wake, share accepted, and any route-level response naming cleanup around old run-trigger terminology.

Open questions (UNCONFIRMED if needed):
- Security/privacy recheck finding resolved by the runtime/Cloudflare importer
  lane: the web producer emits `vault.sync.import`, the workspace bridge imports
  that mailbox route through `vaultSyncPort`, and the import-record callback is
  still the product-owned terminal marker.
- Final review residual: no current migrated producer sets mailbox `expiresAt`, but future expiring producers need advanceable tombstone semantics to avoid lane gaps.
- Final review residual: no Prisma-backed concurrency proof yet for lane-counter raw SQL or simultaneous duplicate appends.
- Final review residual: `payload_hash` duplicate comparison is unproven across `HOSTED_WAKE_ENCRYPTION_KEY` rotation because it has no stored hash key/version metadata.

Working set (files/ids/commands):
- `apps/web/src/lib/vault-sync/session-service.ts`
- `apps/web/test/vault-sync-session-service.test.ts`
- `apps/web/test/vault-sync-import-record-route.test.ts`
- `apps/web/app/api/internal/hosted-execution/vault-sync/import/route.ts`
- `apps/web/src/lib/hosted-mailbox/store.ts`
- `apps/web/src/lib/hosted-onboarding/member-channel-sync.ts`
- `apps/web/prisma/schema.prisma`
- `apps/web/prisma/migrations/20260426020000_hosted_mailbox_payload_hash/migration.sql`
- `apps/web/test/hosted-mailbox-store.test.ts`
- `apps/web/test/hosted-onboarding-member-channel-sync.test.ts`
- `apps/web/test/hosted-mailbox-schema.test.ts`
- `apps/web/test/hosted-runtime-internal-routes.test.ts`
- `pnpm exec vitest run apps/web/test/hosted-mailbox-store.test.ts apps/web/test/hosted-onboarding-member-channel-sync.test.ts apps/web/test/hosted-mailbox-schema.test.ts apps/web/test/hosted-runtime-internal-routes.test.ts --config apps/web/vitest.workspace.ts --no-coverage`
- `pnpm --dir apps/web typecheck`
- `git diff --check -- <touched paths>`
