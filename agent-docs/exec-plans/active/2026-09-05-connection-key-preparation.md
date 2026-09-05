# Prepare device connection keys before member locks

Status: active
Created: 2026-09-05
Updated: 2026-09-05

## Cause and correction

Connection creation and replacement seal access tokens, refresh tokens and the
external account ID inside the member/advisory transaction. Cold device-root
unwrapping therefore waits on KMS while holding
member locks. The canonical prepared-root API already separates external key
preparation from database-only root revalidation and local sealing.

Prepare that root in an attempt-scoped cache after advisory member/consent
admission. Repeat the same admission under the member lock, retain all existing
connection/application/refresh authority checks, revalidate the already-provisioned root at the
existing credential-write boundary, and seal through its exact local reference.
Reuse the existing bounded retry owner for a root-winner race. Keep connection
IDs, token versions and all writes derived under their current transaction.
No schema, new key owner, cross-request cache or additional transaction.

## Scope and proof

Only connection upsert credential writes change. Existing runtime prepared-token
writes and legacy dirty-payload classification retain their own owners.
Prove remote preparation precedes the transaction, local sealing is used under
locks, current consent/member/root authority is rechecked, and root drift never
persists ciphertext. Cover create, replace, preserved connection, OAuth claim
and revoked/suspended cases. Run focused tests, typecheck, lint and complexity
checks; then ReviewGPT concurrent with exact-head CI.

## Candidate proof

The real-crypto full-store tests cover create, replace, consent withdrawal,
suspension and a competing root winner. No KMS operation occurs inside their
transactions. The existing prepared-root tests prove exact identity and local
cache ownership. Web typecheck passes. Complexity debt drops by three in the
connection owner without adding secret-helper debt. This PR will stack on
reconnect #2908 so the two changes compose at the same credential boundary.

113 focused crypto/connection tests, Web typecheck and scoped ESLint pass.
The create and replacement tests fail on the original source with the explicit
assertion that kms.decrypt ran inside the transaction. The same tests pass on
the correction. Missing-root behavior remains fail-closed; preparation never
creates an absent device root.
