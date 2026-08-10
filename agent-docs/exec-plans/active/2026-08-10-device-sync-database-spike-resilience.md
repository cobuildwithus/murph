# Device-sync database spike resilience

Status: active
Created: 2026-08-10
Updated: 2026-08-10

## Goal

Reduce PostgreSQL connection and query amplification on the two device-sync
paths implicated in the 2026-08-10 webhook burst without changing product
authority, durable-work semantics, or runtime ownership.

## Proven incident shape

- One hosted device connection received 1,641 webhook receipts in two minutes,
  peaking at roughly 31 receipts per second.
- Twenty device-sync runtime snapshot reads started in the adjacent minute.
- The database reached 47 of 50 connections and later recovered without lost
  traces or stuck device-sync state.

## Success criteria

- Webhook admission resolves the connection owner once before consent checking
  and passes that authority into the locked acceptance path.
- The locked webhook path reads only the current lifecycle fields needed for
  provider, status, epoch, and setup readiness checks; it does not hydrate or
  decrypt a full connection record.
- Webhook receipt timestamping is a single set-based update with unchanged
  missing-record semantics.
- Unfiltered runtime snapshots materialize connection accounts from the rows
  already selected and fetch sources once for the selected connection set.
- Provider-scoped, bounded source snapshot behavior remains unchanged.
- Focused tests prove authority and fail-closed behavior, deterministic database
  call bounds, and the unchanged webhook trace/dirty-state semantics.
- A local PostgreSQL replay uses the incident counts and arrival distribution,
  overlaps twenty snapshot reads with representative foreground database work,
  and records pool/latency observations without production data.

## Constraints

- `apps/web` remains the product and device-sync control-plane owner.
- Postgres dirty rows and encrypted payload rows remain the durable sources of
  truth; mailbox and Temporal wakes retain their existing pointer-only roles.
- Preserve the live consent recheck, member/connection lock order, connected-at
  epoch fence, source-admission check, trace completion, dirty-state coalescing,
  and exact-payload durability.
- Do not add a queue, scheduler, durable state owner, dependency, or speculative
  crypto cache/batch abstraction.
- Prefer set-based reads and direct projections over new layers.
- Keep production evidence and identifiers out of repository artifacts.

## Tasks

1. [x] Reconfirm current PR head, repository contracts, owner boundaries, and
   the existing unit and real-Postgres test seams.
2. [x] Ask ReviewGPT to return a scoped patch implementing the two production
   changes and incident-shaped replay proof.
3. [x] Inspect the returned patch for scope, privacy, ownership, and semantic
   preservation; apply it only after `git apply --check` succeeds.
4. [x] Run focused tests, hosted-Web typecheck, diff checks, and the local
   incident replay against an isolated development database.
5. [ ] Send the resulting exact diff and evidence through final ReviewGPT;
   resolve every accepted finding.
6. [ ] Close this plan and create a scoped commit/PR handoff.

## Verification

- Focused Vitest suites for hosted webhook wake/admission, runtime snapshot
  authority, connection storage, and connection-source storage.
- A focused real-Postgres incident replay using only synthetic test records.
- `pnpm --filter @murphai/hosted-web typecheck`.
- `git diff --check` and the repository's scoped completion checks.

Completed local proof:

- Four focused hosted-Web suites pass 210 tests covering webhook admission,
  runtime snapshot authority, connection storage, and connection-source
  storage.
- Hosted-Web prepared typecheck passes after generating current Health Commons
  and Prisma outputs.
- The real-PostgreSQL replay passes with 1,641 receipts, a 31-wide admission
  lane, 20 snapshots, and 40 foreground reads. The 15-connection application
  pool reached 15 sessions and 15 active sessions, briefly reported six queued
  requests, and recovered after the 7.8-second compressed replay. Foreground
  p95 was 72.65 ms in that local run.
- The replay observed zero `DeviceConnection.findFirst` calls, 20 set-based
  connection reads, 3,282 owner/lifecycle `findUnique` reads, and 1,661 source
  reads: one preserved live source-admission check per webhook plus one batched
  source read per snapshot.
- Every synthetic trace and signal completed, the advisory webhook timestamp
  advanced to the latest receipt, and the final dirty state acknowledged clean.
