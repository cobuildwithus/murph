# Meal-photo enrollment ordering fence

Status: completed
Created: 2026-08-05
Updated: 2026-08-06

## Goal

- Prevent a canceled meal-photo enrollment request from restoring upload
  authority when its delayed `POST` reaches Web after the member's disabling
  `DELETE`.
- Prevent a schema-v2 enrollment whose response is lost across process death
  from becoming usable upload authority before the iOS host durably saves
  the returned credential.
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
- Privy authentication happens before the member-locked enrollment
  transaction. A later request rejected as unauthorized or member-not-found
  cannot write a revision fence for an older request already admitted as the
  prior member, and a bodyless scoped deletion has no authority when no token
  was ever saved. One-phase issuance can therefore leave an active but
  unrecoverable bearer after process death.

## Architecture and state

- `HostedMealPhotoCaptureEnrollment` remains the sole durable authority owner
  for one member and hashed installation id.
- Schema v2 adds a positive per-installation `authorityRevision` bounded to the
  signed PostgreSQL `INTEGER` range (`1...2_147_483_647`). The iOS client
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
- Schema-v2 `POST` prepares complete credentials with no activation timestamp.
  Its success response remains unchanged, but upload rejects that token until
  the foreground host saves it durably and performs an exact bodyless
  scoped-token `PUT`. The `PUT` is idempotent for the current token.
- Activation and scoped `DELETE` lock the same member and reread the exact
  token. Activation also locks the member's active Family membership and group
  access rows before authority reads. Family billing locks its owner and active
  roster members in stable order before changing those rows, so access loss and
  activation cannot deadlock or commit from stale sponsorship state. Activation
  first followed by deletion ends revoked; deletion first makes activation fail
  authorization. A delayed prepare or lost response is harmless because
  prepared credentials never authorize upload.
- Before activation or idempotent activation replay can succeed, Web rechecks
  historical launch consent and active hosted access inside that same locked
  transaction. A consent withdrawal or access loss therefore remains
  authoritative even when cleanup is delayed or fails.
- Existing rows begin at revision zero and remain immediately active. A null
  activation marker on a legacy revision-zero row is treated as active during
  the rollout window and backfilled after old Web drains. Schema-v1 identity
  requests retain their current behavior only while the row remains at zero; after a v2
  mutation, legacy identity requests fail rather than crossing the fence.
  Exact scoped-bearer self-revocation remains available.

## Compatibility and rollback

- Deploy the additive/nullable Web schema and fence-aware Web code before any
  schema-v2 iOS client.
- Legacy iOS schema-v1 installations continue unchanged at revision zero.
- The post-drain credential-shape constraint makes fence-aware Web the database
  rollback floor because older revocation code retained credential columns.
- Once any installation records a positive authority revision, fence-aware Web
  is also the logical rollback floor: older Web code could ignore the
  high-water mark and reactivate a tombstone.
- Successful enrollment responses keep the existing bearer, idempotency-secret,
  and expiry shape. A revision conflict includes the current revision and
  active/prepared/revoked state so only an explicit foreground enable may reconcile
  local state loss; no credential material is added to conflict responses.

## Scope

- `apps/web/prisma/schema.prisma`, one backward-compatible expand migration,
  and one post-drain contract migration for revision, activation, and
  credential-shape constraints.
- `apps/web/src/lib/device-sync/meal-photo-capture.ts` and the existing Family
  billing lock owner in `apps/web/src/lib/hosted-onboarding/family-plan.ts`.
- `apps/web/app/api/device-sync/companion/meal-photo-capture/enrollment/route.ts`
  for the bodyless scoped activation route.
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
- A schema-v2 response lost before durable iOS-client save remains prepared and
  cannot upload. Persist-then-activate succeeds, exact activation replay is
  idempotent, and scoped activation/deletion are proven in both orders.
- Prepared and already-activated tokens both reject activation after consent
  withdrawal or hosted-access loss; a denied prepared token remains inactive.
- Real PostgreSQL concurrency proof covers sponsored-member removal and group
  billing loss in both commit orders, plus loss-first direct access, consent,
  and scoped-token deletion. Every committed loss rejects activation replay and
  the Family cases prove there is no member-to-group deadlock.
- Schema-v1 behavior remains unchanged at revision zero and cannot cross a
  positive fence.
- Active upload lookup rejects prepared state, tombstones, expiry, and
  incomplete credential state.
- Migration structure, strict request parsing, and route response shapes are
  covered. An opt-in local-PostgreSQL test executes the exact expand and
  contract files, simulates a legacy revision-zero write between them, proves
  active preservation and revoked scrubbing, and exercises the validated
  constraints before hosted-Web typecheck and diff/privacy inspection.

## Completion boundary

- Final ReviewGPT round 1 found that scoped activation did not recheck consent
  or active access, and that the backend documentation accidentally expanded
  automatic meal capture beyond the iOS-only product boundary. Both findings
  were accepted and corrected without adding state or a second owner.
- Round 2 confirmed the consent correction but found that the access guard was
  serialized only by the member row even though Family sponsorship has separate
  mutable membership and group owners. The required retrospective recorded an
  explicit continuation: reuse the existing sponsorship lock and normalize
  Family billing's existing member lock order, with no new state, queue, or
  lifecycle.
- Push the corrected candidate with the real PostgreSQL authority-ordering
  proof, then run final ReviewGPT round 3 and exact-head CI before closing this
  plan.
Completed: 2026-08-06
