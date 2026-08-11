# Bounded Device Snapshot And Companion Status Reads

Status: active
Owner: Codex
Started: 2026-08-11
Updated: 2026-08-11

## Goal

Keep hosted device-runtime snapshots and native companion status reads from
amplifying a connection-history spike into unbounded Postgres or KMS work.
Credential-free projections must not select or decrypt secrets, credentialed
snapshots must page and batch crypto under explicit protocol limits, and
companion status must use narrow set reads.

## Constraints

- Preserve Web as the canonical device-sync control-plane owner and Cloudflare
  as an execution-only consumer of signed snapshots.
- Preserve member, provider, source, application-revision, refresh-lease,
  disconnect, connection-epoch, AAD, authenticity, and consent authority.
- Do not add a persisted cursor, cache, queue, service, retry owner, or broad
  abstraction.
- Use server-owned connection and source limits with stable ordering; never
  silently omit authority required for full runtime hydration.
- Keep every request's datastore, decrypt, KMS, and concurrency bound explicit
  at maximum admitted cardinality.

## Architecture

```text
signed runtime snapshot
        |
        +-- immutable (createdAt, id) page cursor and total hydration bound
        +-- credential-free narrow SQL projection -> opaque connection id
        `-- credential-bearing projection -> set root read -> <=4 KMS unwraps

companion bearer status
        |
        +-- narrow member-owned Junction connection ids/statuses
        +-- one bounded set source projection
        `-- one existing set receipt-signal projection
```

## Progress

- [x] Inspect the current snapshot, assistant caller, companion status, source
      store, secure-box batch, and authority paths.
- [x] Obtain a scoped ReviewGPT implementation patch and inspect it as
      untrusted intent.
- [x] Apply only the accepted bounded projection, paging, and batch changes.
- [x] Add deterministic 32-row query, selected-column, KMS, concurrency,
      cursor, isolation, and incident-shape proof.
- [x] Resolve the preliminary and first full-audit findings: use an immutable
      cursor, collect every `list_accounts` page, scope companion source SQL,
      preserve the first observed secure-box failure while draining, dedupe
      exact application bindings, and remove the displaced per-connection
      source-projection API.
- [x] Replay the real 1,641-receipt incident and the maximum admitted
      app-bound runtime/companion overlap against isolated PostgreSQL.
- [x] Separate the 64-source runtime authority ceiling from the 32-connection
      page ceiling and pin the configured Junction catalog below that bound.
- [x] Run focused tests, direct replay, typecheck, lint, diff, and privacy
      checks.
- [ ] Complete the terminal exact-head ReviewGPT audit and obtain green
      exact-head CI.

## Verification

- Device runtime request/response contract and Cloudflare transport tests.
- Hosted runtime paging/hydration and assistant `list_accounts` tests.
- Hosted Web snapshot authority, connection-secret, companion route, and
  incident-shaped Postgres replay tests.
- Routed package/Web typechecks plus repository diff, privacy, and lint checks.

Local replay evidence: the real PostgreSQL spike harness passed against an
isolated temporary database with 1,641 durable webhook receipts, the original
120-second distribution and 31-receipt peak, 20 overlapping snapshot reads, 40
foreground reads, an overlapping companion status read, and a 15-connection
client pool. It retained all durable work, completed every snapshot through one
bounded source-set read, and stayed within the configured pool ceiling. The
same real-database suite proves that mutating `updatedAt` on the 33rd connection
cannot make the immutable page cursor omit it, and overlaps one 32-connection
app-bound runtime snapshot with one 32-connection scoped companion status read.
That maximum-shape proof performs one application-binding lookup, filters 33
unrelated source rows in SQL, and fails closed only when the requested source
itself reaches 33 rows on one connection. A dedicated authority proof retains
all 33 currently configured Junction sources in both redacted and credentialed
runtime snapshots, uses one source-set query per request, and fails closed only
above the independent 64-source ceiling.

Round-four retrospective: the accepted finding exposed a distinct cardinality
conflation between connection pages and source authority, not another instance
of the previously corrected single-page consumer. The remediation adds one
protocol-owned constant and boundary proofs while retaining the existing set
query, fail-closed overflow detector, and ownership model. No cursor, cache,
service, retry owner, or persisted state was added.

## Rollout

The snapshot request/response contract crosses Web and Cloudflare. Deploy the
cursor-aware Cloudflare/assistant reader before the Web producer. The reader
omits the first request limit and accepts a legacy complete response only under
the 100-connection total hydration ceiling; subsequent cursor pages are
explicitly bounded to 32.
