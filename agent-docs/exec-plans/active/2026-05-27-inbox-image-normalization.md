# Inbox Image Normalization

Status: active
Created: 2026-05-27
Updated: 2026-05-27

## Goal

Make canonical inbox persistence normalize future still-image attachment bytes
before they are hashed, recorded, and stored under `raw/inbox/**`.

## Success Criteria

- Eligible JPEG, PNG, and WebP image attachments are stored as bounded WebP
  bytes with matching `mime`, `fileName`, `byteSize`, `sha256`, and
  `storedPath` metadata.
- Attachment normalization is isolated in an inbox-owned storage helper rather
  than embedded directly in persistence orchestration.
- The envelope input and inbox-capture ledger do not preserve the original
  image byte size for normalized images.
- Corrupt eligible images fail closed without persisting the original bytes.
- Non-image or ineligible attachments preserve existing storage behavior.
- Focused tests and required repo verification pass, or unrelated blockers are
  recorded.

## Scope

- In scope:
  - `packages/inboxd` canonical attachment persistence.
  - A small Node-only image storage normalizer.
  - Focused inboxd tests and package dependency metadata.
  - Durable wording updates for canonical inbox evidence if needed.
- Out of scope:
  - Hosted raw `.eml` deletion or R2 lifecycle TTL changes.
  - Historical raw attachment rewrites.
  - Connector-specific compression.

## Constraints

- Preserve raw-artifact immutability for existing captures.
- Do not transform bytes inside the hosted artifact store.
- Do not expose secrets, personal identifiers, raw health payloads, local paths,
  or attachment contents in logs, docs, tests, or handoff.
- Keep the change narrow and avoid new generic attachment abstractions unless
  directly needed by the persistence invariant.

## Tasks

1. Inspect the current inbox persistence and test seams.
2. Add the storage normalizer and direct dependency metadata.
3. Refactor attachment byte storage so normalization happens before path,
   hash, byte-size, envelope, and ledger metadata are finalized.
4. Add focused tests for normalized images, unchanged non-images, parser jobs,
   and corrupt-image fail-closed behavior.
5. Run package/repo verification and completion audits.
6. Close the active plan and commit through `scripts/finish-task`.

## Verification

- Focused inboxd tests covering image normalization.
- `pnpm --dir packages/inboxd test`
- `pnpm deps:guard`
- `pnpm typecheck`
- `pnpm test:diff packages/inboxd`
