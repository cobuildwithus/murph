# r2-read-latency-traces

Status: active
Created: 2026-08-06
Updated: 2026-08-06

## Goal

- Make cold workspace-restore telemetry distinguish R2 response wait and body
  consumption from local decrypt/extract/filesystem work, without adding an
  awaited operation, network request, synchronous log write, or foreground
  reporting call.

## Success criteria

- Existing restore behavior and retry semantics remain unchanged.
- The existing hosted latency milestone carries bounded numeric timings for
  successful GET response-header wait and response-body consumption.
- Focused tests prove the timings are populated, sanitized, and reported
  through the existing trace path.
- Static call-path proof shows no new I/O, await, retry, or logging operation.
- Required exact-head review and CI complete with no unresolved findings.

## Scope

- In scope: the direct-R2 workspace snapshot restore path, its existing latency
  phase-breakdown schema/parser, focused tests, and durable runtime protocol
  documentation if the trace contract changes materially.
- Out of scope: changing R2 routing, caching, retry behavior, archive format,
  restore concurrency, user-visible reply behavior, or adding a new telemetry
  service/store.

## Constraints

- Technical constraints: timings must be metadata-only, bounded safe integers;
  collect them in memory with constant-time clock reads and merge them into the
  already-existing latency milestone after restore.
- Product/process constraints: preserve the foreground reply critical path and
  production privacy; use aggregate timing fields only, with no object keys,
  URLs, member identifiers, or payload content.

## Risks and mitigations

1. Risk: a new timer accidentally introduces an awaited reporting side effect.
   Mitigation: mutate only an invocation-local timing object and reuse the
   existing staged latency milestone/reporting path.
2. Risk: a field is mislabeled as pure network latency despite streaming
   consumer backpressure.
   Mitigation: use precise response-header and body-consumption names and
   document what each interval includes.
3. Risk: retries mix timings from failed and successful attempts.
   Mitigation: create attempt-local timing state and publish only the final
   successful attempt while retaining the existing total step timer for
   retry-inclusive user wait.

## Tasks

1. [complete] Audit current fetch, stream, retry, parser, merge, persistence,
   and tests.
2. [complete] Add the smallest attempt-local timing split at the existing stream
   boundary.
3. [complete] Extend schema/parser and focused unit/integration proof.
4. [complete] Run focused verification and inspect the diff for hot-path/I/O
   impact.
5. [in progress] Commit, push, open a PR, and complete required ReviewGPT and CI
   gates.

## Decisions

- No separate telemetry call or structured log event; reuse the existing
  `phase_breakdown_json.restore` milestone.
- Cloudflare's ordinary R2 operations dataset does not expose per-object
  request duration, so provider analytics cannot supply this missing split.
- `objectFetchMs` remains retry-inclusive. The response-header and body-read
  fields describe only the final successful GET attempt; body-read time
  includes streamed consumer backpressure and is not labeled pure network time.
- Do not attempt per-chunk CPU timing, which would add work proportional to
  response chunk count.

## Verification

- Focused Cloudflare restore/stream/retry tests: 145 passed.
- Hosted-execution parser/control tests: 32 passed.
- Assistant-runtime restore pass-through tests: 24 passed.
- Web latency parse/merge/store tests: 32 passed.
- Cloudflare, hosted-execution, assistant-runtime, and web typechecks passed.
- Agent-doc drift, doc gardening, and `git diff --check` passed.
- Hot-path inspection: the diff adds two `Date.now()` pairs and local numeric
  assignments per GET attempt. The existing fetch and restore awaits remain the
  only awaited boundaries, and request-count assertions remain three calls for
  the ordinary restore and two object GET attempts for the retry fixture.
- Preliminary specialists: accepted one coverage-only finding. The existing
  runner fixtures now use a Date-only fake clock and pull-controlled streams to
  prove exact 25/30 ms successful response/body spans and exact 7/11 ms final
  successful-attempt spans after a deliberately slower failed attempt. The 145
  runner tests and Cloudflare typecheck passed after applying that test-only
  patch.
- Final ReviewGPT round 1: `ROUND_OUTCOME: PASS` with no qualifying code
  findings. Its PR-body cardinality note was verified against the default
  50-item initial mailbox import and corrected without changing repository
  code.
- Pending: exact final-head CI.
