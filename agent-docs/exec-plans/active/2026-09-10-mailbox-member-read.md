# Reuse fresh member state during mailbox fetch

## Outcome and invariants

Remove repeated member queries from ordinary mailbox fetching. Web remains the
owner of current access, consent, billing and usage; no state survives the request.
Suspension, group participant authority, usage denial confirmation and mailbox
watermarks retain their existing behavior. No provider input changes.

## Evidence and design

The fetch route reads access, the runtime usage adapter rereads consent/access,
and the allowance reader rereads billing/credits. Their existing owners can accept
one typed member projection loaded by the fetch boundary. Keep usage-period reads
and authoritative denial confirmation with the allowance owner. Do not cache
Prisma calls or introduce another gate owner. Group participant and Family billing
reads remain where current authority requires them.

## Verification and delivery

- Prove the composed route uses one member read on ordinary allow and reloads on
  the next request; exercise consent withdrawal, suspension, group access,
  exhaustion confirmation, empty/system/consumed replay and provider selection.
- Run focused Web tests, Web typecheck and complexity guard; review the full diff.
- Publish a separate draft PR, finish required review and exact-head CI, then
  leave it merge ready. This Web-only projection change preserves the wire
  contract and needs no deployment ordering or persisted migration.

## Progress

- Implemented explicit request-local projection reuse at existing readers. The
  mutating mode cannot accept a projection; read-first denial confirmation always
  reloads through its existing owner. No cache or new service was introduced.
- Product UX Patch: less repeated work before processing; individual and group
  conversation plus empty/system/replay and revoked-access paths covered. Ready
  at the tested fetch boundary; live typing latency requires deployment evidence.
- 241 focused Web cases passed, including a composed real-route/gate proof of one
  member read and next-request consent/suspension/deletion changes. Existing group
  and Family allowance cases pass. Full Web typecheck passed before final proof
  additions; final prepared typecheck and changelog SSR proof are running.
- Complexity guard passed; all five reported >20 hotspots are unchanged allowance
  pricing/period functions outside this correction. Final review and CI pending.
