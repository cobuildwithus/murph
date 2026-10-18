# Sleep-list dated row selection

Status: active
Created: 2026-10-18
Updated: 2026-10-18
Base: `dc512788835a48db367fbc2e9317d7e24a5fc636`.

## Goal

- A dated ordinary sleep-list read (`date`, `from` or `to`) captures only stored
  wearable rows inside its day bounds, with byte-identical public output.
- Cause: the old reader selected and decoded every stored date for the provider
  scope; the composer already discarded rows outside the requested dates before
  composition. The waste was that row read and decode, not composition of
  unrelated dates.

## Success criteria

- `summarizeWearableSleepRuntime` passes day-prefixed bounds to the existing
  `readFreshWearableSummaryRows`; no summary-kind filter.
- Public output equals the original providers-only full-row composition for
  bounded, unbounded, datetime-shaped, empty-string, inverted and provider-scoped
  filters, fresh and stale.
- The benchmark fails on any public/oracle mismatch and reports the stored rows
  and decoded bytes that dated reads no longer materialize.

## Scope

- In scope: the one sleep-list runtime reader, focused regression tests, the
  synthetic benchmark, the query README contract and one changelog entry.
- Out of scope: kind pruning, source-health, sleep-pattern and Personal Patterns
  (PR3391), freshness/rebuild/lock policy, the historical 49s Patterns tail and
  the 17s source lock wait.

## Constraints

- Technical constraints: preserve provider normalization including empty and
  unknown scopes, ordering, limits, conflict evidence, strict source validation,
  canonical lock/reentrancy, stale rebuild and freshness ownership.
- Product/process constraints: synthetic fixtures only; no production access or
  numerical production speedup claim.

## Risks and mitigations

1. Risk: pruning by kind changes composed multi-provider sleep, because shared
   recovery/activity keys (HRV, SpO2, respiratory rate) feed sleep resolution.
   Mitigation: rejected; every kind stays selected and a test pins the difference.
2. Risk: SQL and composer date predicates disagree for datetime-shaped or empty
   filters. Mitigation: mirror the composer (truthy `date` wins, ISO day prefix,
   empty ignored); parity cases plus a prefix-removal mutation check.
3. Risk: corrupt stored rows outside the requested dates are no longer decoded,
   so they no longer fail a dated read; a corrupt null-date non-health row is
   dropped. Mitigation: accepted, matching the sleep-pattern reader; canonical
   source validation and rebuild are unchanged.

## Tasks

1. Synthetic baseline benchmark on unchanged base (done).
2. Dates-only selection plus focused regression tests (done).
3. Benchmark hard oracle assertion and materialization report; plan, index,
   README wording and changelog entry (done).
4. Parent: independent benchmark, owner suites, build/typecheck, real-Codex
   sleep journey (done; see Verification).
5. Pending: final ReviewGPT on the stable pushed head, exact-head CI, merge,
   deploy and post-deploy observation for
   [PR #4181](https://github.com/cobuildwithus/murph/pull/4181).

## Decisions

- Kind pruning (`sleep`/`source_health`) rejected: changed output in every
  multi-provider case; with datetime-shaped bounds it also dropped a night.
- Dates-only accepted by parent.

## Evidence and known limitations

- Pre-change synthetic run (365 days, 3 providers, 8,687 events): dated warm
  medians fell from 58-67 ms to 5-16 ms with identical SHA-256; undated
  `limit` reads unchanged (~320 ms). Stale reads are dominated by the ~550-600 ms
  wearable rebuild, which this change does not touch.
- Production aggregate (latest 72h): stale rebuilds were 22.7 s of 29.3 s
  inclusive sleep-list time (~77%); untouched here. The share of production
  sleep-list calls carrying date bounds is unknown, so no production gain is
  claimed.
- #3997 investigation remains open: this fix does not explain the historical
  49s Patterns tail, the 17s canonical lock wait, stale rebuild costs or the
  pre-telemetry 302s group read.

## Verification

Parent verification for [PR #4181](https://github.com/cobuildwithus/murph/pull/4181):
- Focused query tests: 124 passed, one pre-existing skip. Query typecheck and
  benchmark tsconfig passed; full CLI dependencies built.
- Real-Codex journey (`gpt-6.1-sol`, subscription): one exact dated Oura read,
  correct 450-minute actual-sleep reply, no effects; Ready.
- Changelog: 10 render tests passed.
- Complexity: no changed hotspots above 20; query maximum 14. Docs drift and
  gardening: 0 findings.
- Independent same-fixture benchmark, 7 rotated warm samples, median (range):

  | Case | Reference ms | Public ms | Stored rows / decoded bytes |
  | --- | --- | --- | --- |
  | 14 days, all providers | 67.083 (66.033-82.551) | 15.641 (15.251-17.018) | 3,410 / 9,625,444 to 134 / 369,512 |
  | One date | 57.896 (56.212-58.824) | 4.605 (3.620-5.866) | 3,410 / 9,625,444 to 13 / 29,218 |
  | Undated | 314.952 | 317.460 (no useful change) | unchanged |

  Full result bytes and SHA-256 matched; `publicOracleMismatches` 0. Builds and
  the benchmark ran the actual runtime path. No production speedup is claimed.

Pending, plan stays active:
- Final ReviewGPT: the primary author attempt failed before submission; all six
  configured lanes have profile locks and no reachable CDP endpoint. No lock was
  deleted and no unowned process stopped. Parent will attempt the final gate
  after the stable push; the gate is not waived.
- Exact-head CI, merge, deploy and post-deploy observation.
