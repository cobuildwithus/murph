# Persist device-sync dirty-payload credential authority

Status: active
Created: 2026-08-10
Updated: 2026-08-10

## Goal

- Remove payload decryption, provider-module loading, and data-dependent
  iteration from the database transaction that supersedes stale device-sync
  work during a connection credential-epoch replacement.
- Preserve already accepted imports that can finish without the replaced
  provider credentials.

## Success criteria

- Every newly encrypted `device_sync_dirty_payload` row stores the
  server-derived `credential_independent` classification beside its ciphertext.
- Classification, compression, and secure-box sealing finish before a
  caller-owned admission transaction begins; the dirty-payload store performs
  only prepared-revision validation and database mutation after entry.
- Reconnect cleanup locks and compare-and-sets the dirty marker, rejects any
  mixed-version unclassified rows, resets the compact marker, and deletes
  credential-scoped payloads with set-based database writes only.
- Nullable rows created during mixed-version rollout are classified in bounded
  batches behind the existing member-row consent fence; withdrawal completion
  always orders before any later legacy decryption.
- Exact payload identity, encryption AAD, companion replay receipts, account
  deletion ordering, and runtime ack semantics remain unchanged.

## Scope

- Hosted Web Prisma schema and forward migration.
- Dirty-payload preparation, persistence, and reconnect supersession.
- Webhook and companion callers that already own the surrounding atomic commit.
- Focused unit, migration, and PostgreSQL ordering proof.

## Constraints

- Do not add a second queue, classification service, background job, durable
  owner, or provider-specific persistence path.
- Do not store decrypted payload data or provider credentials in the new
  column. The value is one server-derived boolean authority bit.
- Retain the existing short connection/member serialization boundary in this
  PR. Removing generic mutation-lock callbacks is a separate follow-up that
  must replace their ordering guarantees with explicit versioned writes.
- Fail closed on malformed or unreadable legacy payloads and on unresolved
  mixed-version rows.

## Tasks

1. Add the nullable classification column and migration guard.
2. Make dirty-payload preparation an explicit two-phase store API.
3. Persist the classifier result while sealing every new payload.
4. Classify legacy nullable rows only after the member lock and consent re-read.
5. Replace reconnect-time decrypt/classify iteration with set-based cleanup.
6. Add mixed-version, classifier, transaction-boundary, and deletion-ordering
   regressions.
7. Run focused tests, Web typecheck/lint, migration checks, exact-head CI, and a
   final skeptical review before marking the PR ready.

## Rollout

- Apply the additive nullable-column migration before or with Web deployment.
- Mixed old/new Web processes may coexist: new writers populate the bit; old
  writers leave it null. A reconnect classifies at most 800 null rows inside the
  existing consent-ordered member transaction and fails retryably for a larger
  backlog until runtime acknowledgement reduces it.
- After old writers have drained, nullable rows should naturally converge to
  zero without a backfill worker. A future contract migration may make the
  column non-null only after production evidence proves that condition.
