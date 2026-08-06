# Meal-photo enrollment ordering fence

Status: active
Created: 2026-08-05
Updated: 2026-08-05

## Goal

- Prevent a canceled meal-photo enrollment request from restoring upload
  authority when its delayed `POST` reaches Web after the member's disabling
  `DELETE`.
- Preserve the existing iOS schema-v1 enrollment behavior until an installation
  adopts the fenced schema-v2 contract.
- Keep one Web-owned per-installation authority record; do not add a second
  queue, lease owner, or enrollment service.

## Root-cause evidence

- Identity-authenticated revocation currently updates only an existing active
  enrollment and stores nothing when the row is absent.
- Enrollment serializes on the same member lock, but a later-arriving `POST`
  explicitly clears `revokedAt` and rotates the bearer. The lock therefore
  preserves network arrival order rather than the member's later disable intent.
- Existing concurrency coverage proves only `POST` first and `DELETE` second;
  it does not exercise the inverse arrival order.

## Architecture and state

- `HostedMealPhotoCaptureEnrollment` remains the sole durable authority owner
  for one member and hashed installation id.
- Schema v2 adds a positive per-installation `authorityRevision` bounded to the
  signed PostgreSQL `INTEGER` range (`1...2_147_483_647`). The native client
  durably allocates a fresh larger revision before every identity enrollment or
  revocation request.
- Web accepts a v2 mutation only when its revision is newer than the stored
  high-water mark. An exact disabled revision replays as revoked; older or
  conflicting mutations fail with a revision conflict.
- Identity `DELETE` upserts a disabled row even when no credential was ever
  issued. Credential columns become nullable so that row is an honest
  no-authority tombstone rather than fabricated credential material.
- A later explicit re-enable uses a larger revision. A delayed older `POST`
  cannot cross the tombstone.
- Existing rows begin at revision zero. Schema-v1 identity requests retain
  their current behavior only while the row remains at zero; after a v2
  mutation, legacy identity requests fail rather than crossing the fence.
  Exact scoped-bearer self-revocation remains available.

## Compatibility and rollback

- Deploy the additive/nullable Web schema and fence-aware Web code before any
  schema-v2 native client.
- Legacy iOS schema-v1 installations continue unchanged at revision zero.
- The post-drain credential-shape constraint makes fence-aware Web the database
  rollback floor because older revocation code retained credential columns.
- Once any installation records a positive authority revision, fence-aware Web
  is also the logical rollback floor: older Web code could ignore the
  high-water mark and reactivate a tombstone.
- Successful enrollment responses keep the existing bearer, idempotency-secret,
  and expiry shape. A revision conflict includes the current revision and
  active/revoked state so only an explicit foreground enable may reconcile
  local state loss; no credential material is added to conflict responses.

## Scope

- `apps/web/prisma/schema.prisma`, one backward-compatible expand migration,
  and one post-drain contract migration for credential-shape constraints.
- `apps/web/src/lib/device-sync/meal-photo-capture.ts`.
- `apps/web/app/api/device-sync/companion/meal-photo-capture/enrollment/route.ts`
  only if response or route wiring requires it.
- Focused meal-photo enrollment, route, validation, and migration tests.
- `ARCHITECTURE.md`, `agent-docs/SECURITY.md`,
  `agent-docs/RELIABILITY.md`,
  `agent-docs/operations/verification-and-runtime.md`, and
  `agent-docs/references/testing-ci-map.md`.

## Focused proof

- `DELETE(revision 2)` before `POST(revision 1)` leaves a tombstone and rejects
  the delayed enrollment, both with and without a prior active row.
- `POST(revision 1)` before `DELETE(revision 2)` ends disabled.
- Exact disabled-revision replay is idempotent; stale deletion cannot revoke a
  newer enrollment; a fresh higher revision can explicitly re-enable.
- A duplicate or same-revision enrollment cannot rotate an unrecoverable
  plaintext bearer.
- Schema-v1 behavior remains unchanged at revision zero and cannot cross a
  positive fence.
- Active upload lookup rejects tombstones and incomplete credential state.
- Migration structure, strict request parsing, and route response shapes are
  covered, followed by the hosted-Web typecheck and diff/privacy inspection.

## Completion boundary

- Stop before commit, push, PR, ReviewGPT, CI, or external deployment so the
  parent can review the implementation candidate first.
