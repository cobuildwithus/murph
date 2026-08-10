# Correct Linq inventory lock deletion

Status: completed
Created: 2026-08-10

## Goal

- Correct PR #1534 so both multi-line Linq synchronization paths use their
  prepared set-based statements without the inventory-wide advisory lock.
- Keep the provider inventory application as one parameterized VALUES/CTE
  statement, as explicitly requested, while preserving ordinary provider-id
  moves and transaction-level atomicity.

## Success criteria

- No multi-line configured/provider snapshot path acquires the inventory-wide
  advisory lock or loops through per-phone writes.
- Provider inventory executes one bulk database statement per transaction
  attempt; configured-line synchronization also executes one bulk statement.
- Phone normalization, lookup-key preparation, encryption, hinting, dedupe,
  bounds, and deterministic ordering remain outside transaction entry.
- Focused unit and real-PostgreSQL tests cover exact state, ordinary provider-id
  moves, reversed input order, concurrent convergence, and statement count.
- The exact pushed head passes ReviewGPT and required GitHub checks.

## Scope

- In scope: the PR's Linq line-store, provider-inventory, contact-card coupling,
  focused tests, and PR/process documentation.
- Out of scope: schema changes, new state, arbitrary provider-id permutations,
  single-phone webhook/delivery writers, and frontend behavior.

## Decisions

- Reject the preliminary remediation that reintroduced the inventory advisory
  lock: review findings do not override the user's explicit deletion request,
  and the lock broadened into unrelated contact-card reads.
- Retain the single-phone advisory lock only for unrelated single-phone writers;
  multi-line paths do not call that writer.
- Treat a complete provider snapshot as one atomic SQL statement. PostgreSQL
  MVCC publishes the statement only at commit; readers may see the prior
  committed snapshot while it is in flight, which is the ordinary transaction
  contract and not a partial publication.

## Verification

- Focused hosted-Web Vitest slices for line store, inventory, provider health,
  contact-card, and sync script.
- Opt-in real-PostgreSQL inventory proof against a fresh local throwaway DB.
- Hosted-Web prepared typecheck and `git diff --check`.
- Exact-head final ReviewGPT and required GitHub Actions.

## Progress

- Removed the reintroduced inventory advisory lock from configured/provider
  writers and from contact-card reads.
- Restored one provider VALUES/CTE statement and one configured VALUES/CTE
  statement, then removed their explicit inventory-wide `FOR UPDATE` barriers
  so the unique keys and ordinary DML row locks own conflict convergence.
- Focused unit proof: 107 tests passed across contact-card, line-store,
  provider-inventory, provider-health, and sync-script slices; the directly
  affected line-store/inventory rerun passed 42 tests after the final SQL
  simplification.
- Real-PostgreSQL proof: 12 tests passed on a fresh migrated throwaway database
  after the final SQL simplification; the database was removed after the run.
- Prepared hosted-Web typecheck passed on the final candidate.
- `git diff --check` and the scoped identifier/privacy scan passed.
Updated: 2026-08-10
Completed: 2026-08-10
