# Hosted Runtime Wave Two

## Goal

Build the runtime-owned mailbox import and checkpoint loop on top of the Wave
One contracts, while preserving the greenfield target: Cloudflare remains a
thin per-user runner and web remains a storage/control callback surface, not an
execution queue owner.

Success criteria:

- Phase 1 side-input port gap is closed with explicit runtime-facing ports for
  mailbox payloads, share payload/import results, and vault-sync payload/import
  results.
- Runtime mailbox import helpers persist per-lane imported watermarks under
  portable assistant runtime state, not web-owned run cursors or inbox
  `source_cursor`.
- Runtime import fetches strict per-lane prefixes, imports durably before
  advancing watermarks, and checkpoints imported progress through
  `workspacePort.checkpoint`.
- Conversation mailbox items are routed toward the same local capture/inbox
  machinery used by local assistant automation.
- Missing sidecar payloads, malformed mailbox items, and unsupported kinds are
  represented as runtime-local quarantine/status, not web-owned adoption state.

## Constraints

- Preserve unrelated dirty work in the shared checkout.
- Do not touch Cloudflare Durable Object runner internals in this wave unless a
  returned worker proves a minimal compile-only adapter is unavoidable.
- Do not migrate web producers or delete old run/ingress schema in this wave.
- Do not reintroduce run adoption, run finalization, committed sequence targets,
  executor queues, or inbox `source_cursor` hosted progress.
- Keep logs and status redacted: no message text, provider payloads, secrets,
  contact identifiers, decrypted vault content, or local filesystem paths.
- Use declared package entrypoints only.

## Ownership

- Parent: close the Wave One runtime side-input port gap and coordinate
  integration.
- Worker A: runtime mailbox state/watermark helpers and focused tests.
- Worker B: mailbox fetch/import loop plus checkpoint-after-import tests.
- Worker C: semantic mailbox kind routing/quarantine design and implementation
  hooks, with no Cloudflare/web producer migration.

## State

Landed and superseded by the current destructive cleanup wave.

Completed:

- Wave One contract, runtime-port, and web storage groundwork is focused
  verified.
- `HostedRuntimePlatform` has explicit semantic side-input ports for mailbox,
  workspace, logs, share, vault-sync, device-sync, raw payloads, usage export,
  issue export, and billing.
- Runtime mailbox import owns per-lane imported watermarks under portable
  assistant runtime state and does not use web run cursors or inbox
  `source_cursor`.
- Runtime imports strict mailbox prefixes, checkpoints immediately after import,
  rolls back imported progress on checkpoint failure, and refreshes mailbox input
  before assistant delivery so local turn revision can see late same-conversation
  messages.
- Conversation mailbox items route into the local capture/inbox path.
- Vault-sync mailbox items are now imported by runtime-owned logic through
  `vaultSyncPort`, then recorded through the semantic web callback.
- Cloudflare workspace-run bridge adapters now restore snapshots, import
  mailbox items, checkpoint via lease-validated workspace CAS, and route through
  the local hosted runtime entrypoint.

Now:

- Cleanup only: remove stale docs/tests that still require old hosted-run
  status, commit/finalize, run-drain, or peek/adopt semantics after production
  paths have moved to mailbox/workspace.

Next:

- Finish Cloudflare DO state simplification, local outbox checkpoint semantics,
  remaining web producer migration, final Prisma deletion, and shared run
  contract deletion.

## Verification Targets

- `pnpm --dir packages/assistant-runtime test:coverage`
- `pnpm --dir packages/assistant-runtime typecheck`
- `pnpm typecheck`
- `pnpm test:smoke`
- `git diff --check` on touched files
