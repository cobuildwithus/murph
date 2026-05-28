# Inbox Image Normalization

Status: completed
Created: 2026-05-27
Updated: 2026-05-27

## Goal

Make canonical inbox persistence normalize future image attachment bytes before
they are hashed, recorded, and stored under `raw/inbox/**`.

## Success Criteria

- Decodable static image attachments are stored as bounded WebP bytes with
  matching `mime`, `fileName`, `byteSize`, `sha256`, and `storedPath` metadata.
- Attachment normalization is isolated in an inbox-owned storage helper rather
  than embedded directly in persistence orchestration.
- The envelope input and inbox-capture ledger do not preserve the original
  image byte size for normalized or unstored images.
- Corrupt, unsupported, and animated/multipage images fail closed without
  persisting the original bytes.
- Non-image attachments preserve existing storage behavior.
- Hosted email prompt projection does not carry decoded attachment byte sizes.
- Focused tests and required repo verification pass, or unrelated blockers are
  recorded.

## Scope

- In scope:
  - `packages/inboxd` canonical attachment persistence.
  - A small Node-only image storage normalizer.
  - Focused inboxd tests and package dependency metadata.
  - Hosted email prompt projection attachment-size minimization.
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

- Focused inboxd tests covering image normalization and fail-closed unsafe
  image claims.
- `pnpm --dir packages/inboxd test -- test/inbox-image-storage-normalization.test.ts`
- `pnpm --dir packages/inboxd test`
- `pnpm --dir packages/inboxd typecheck`
- `pnpm --dir apps/cloudflare test -- hosted-email-worker-ingress.test.ts`
- `pnpm deps:guard`
- `pnpm typecheck`
- `pnpm test:diff packages/inboxd`

## Current State

- Added a Node-side attachment storage normalizer where non-images pass
  through and images normalize to bounded static WebP or become unstored.
- Refactored inbox persistence so attachment paths, hashes, byte sizes,
  envelope input metadata, and ledger attachment metadata are finalized after
  storage normalization.
- Added focused tests covering image data, original-path images, non-image
  pass-through, unsupported MIME/extension image normalization,
  descriptor-only and missing-original-path image size clearing,
  corrupt/mislabeled/animated-image fail-closed behavior, and parser job
  enqueue.
- Removed decoded hosted email attachment sizes from prompt projection and
  covered that with a Cloudflare hosted-email ingress test.
- Security/privacy and simplification audits completed; findings were fixed by
  validating decoded image format, failing closed for animated/multipage
  eligible images, and removing dead `rawCopies` inbox persistence plumbing.
- Completion coverage pass added extension-only mislabeled image proof.
- Latest focused inboxd test/typecheck passed after final review coverage for
  missing original-path image attachments; Cloudflare hosted-email test command,
  diff-aware workspace verification, dependency guard, and repo typecheck also
  passed. Dependency audit remains blocked by the existing unrelated
  `js-cookie` advisory.
Completed: 2026-05-27
