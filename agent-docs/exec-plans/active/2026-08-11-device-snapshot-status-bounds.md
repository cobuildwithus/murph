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
        +-- protocol-owned page/cursor and total hydration bound
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
- [ ] Run focused tests, direct replay, typecheck, lint, diff, privacy, and
      exact-head completion gates.
- [ ] Open the PR after the prerequisite guidance PR merges, complete
      ReviewGPT specialist/final audits, and obtain green exact-head CI.

## Verification

- Device runtime request/response contract and Cloudflare transport tests.
- Hosted runtime paging/hydration and assistant `list_accounts` tests.
- Hosted Web snapshot authority, connection-secret, companion route, and
  incident-shaped Postgres replay tests.
- Routed package/Web typechecks plus repository diff, privacy, and lint checks.

Local replay evidence: the real PostgreSQL spike harness passed against an
isolated temporary database with 1,641 durable webhook receipts, the original
120-second distribution and 31-receipt peak, 20 overlapping snapshot reads, 40
foreground reads, and a 15-connection client pool. It retained all durable
work, completed every snapshot through one bounded source-set read, and stayed
within the configured pool ceiling.

## Rollout

The snapshot request/response contract crosses Web and Cloudflare. Deploy the
cursor-aware Cloudflare/assistant reader before the Web producer. The reader
omits the first request limit and accepts a legacy complete response only under
the 100-connection total hydration ceiling; subsequent cursor pages are
explicitly bounded to 32.
