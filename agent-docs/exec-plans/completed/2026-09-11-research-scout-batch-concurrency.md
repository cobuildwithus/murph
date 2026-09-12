# Research scout batch concurrency

Status: implementation complete; parent verification and release evidence pending.
Base: supplied clean-main source snapshot `5a384e320795` (no Git metadata in the archive).

## Outcome and protected boundary

Outcome: remove serial waiting between independent managed research searches.
Reaches: multi-lane scout batches; preserve one-lane batches and focused single
scouts. No prompt, schema, candidate-selection, persistence, or delivery changes.
Proof: controlled deferred transport/body reads at the real client boundary,
registered CLI composition, and a repeatable synthetic baseline/current benchmark.

The existing batch client is the scheduling owner. Shared contracts validate
all input before egress; the runner-scoped client validates each outgoing
request, and hosted provider authorization still runs per operation. The
supplied private-safe timing summary points to dispatch but cannot attribute
production latency to individual lanes or establish an exact production gain.
The old serial loop and the supplied four-lane synthetic baseline establish the
mechanism without using member data or a real provider.

## Implementation decisions

- Replace only the batch loop with two local native-Promise workers. Store
  responses at their input index, refill each free slot, and keep the complete
  provider envelope. No pool abstraction, dependency, flag, or durable state.
- Compose a batch AbortController with the caller signal. Record the first
  observed failure before aborting siblings. Each worker catches its failure;
  await every worker before rethrowing the original error. Aborted batches
  never admit queued lanes or return partial success, including when an
  already-running transport completes despite cancellation. Pre-abort makes
  no fetch. Existing per-request deadlines, body classification, and no-retry
  behavior stay with the unchanged runner client.
- Up to two already-authorized provider calls can overlap where the old serial
  path would have stopped after one. Cancellation is not rollback of provider
  work or spend. No schema/deployment skew or persisted-state convergence is
  introduced; reverting the scheduler restores serial reads for new calls.
- Add deterministic tests for capacity/refill/order, body-held slots, complete
  responses, one-lane parity, whole-input validation, absent/blank credentials,
  first/second/mid-batch failures, delayed sibling settlement, caller abort and
  controlled deadlines during headers/body, late success after abort, no
  unhandled rejection, and registered CLI date/input/output composition.
- Keep the existing managed research real-Codex journey: the assistant-visible
  contract is unchanged. Do not add another stochastic journey or transcripts.

## Local evidence and limits

The archive lacks installed dependencies, pnpm, its lockfile, and Git metadata.
Registry DNS is unavailable. Node here is 22.16.0, not the package's required
24.14.1 or later. The referenced Frog/changelog skills are absent; `scripts/frog
list` reports the missing installation. This is a snapshot/tooling limitation,
not evidence of a new repository defect.

Local checks completed: TypeScript syntax transpilation for the changed source
and test, benchmark JavaScript syntax, and 49 isolated actual-client scheduling
assertions with native AbortController/Response/ReadableStream. That isolated
harness substitutes SDK forwarding and contract-shape doubles, so it is NOT a
pass of the committed source suites, actual SDK/schema integration, or composed
CLI test. It also confirms unchanged single-scout and runner-transport source.
The actual changelog fragment loader accepts the new entry; changed-line
whitespace and plan/index target checks also pass.
A mechanical four-lane run produced the same 790 bytes and four calls with
peak one versus two; timing from those doubles is not canonical benchmark or
production evidence.

Full source suites, package typecheck, canonical benchmark, complexity/docs
checks, exact-head CI, and real-Codex reply review remain parent-owned and
pending. Product UX: deterministic scheduling boundary checked; assistant reply
review is **Hold** pending the existing journey. No commit, push, PR, deployment,
production request, or member-facing delivery was performed.

## Parent verification (no production/test edits required)

Run in the normal installed workspace on the patched candidate:

```bash
pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage \
  packages/cli/test/research-scout-batch.test.ts \
  packages/cli/test/research-scout.test.ts \
  packages/cli/test/research-question.test.ts
pnpm --dir packages/cli typecheck
pnpm complexity:diff
pnpm docs:drift
```

The benchmark bundles both actual client sources against the same current
workspace dependency graph and canonical `tsconfig.base.json`; it does not
reimplement a serial scheduler. Four lanes have the labels sleep, recovery,
nutrition, exercise, each with the public sleep topic and a fixed window. Each
fake fetch delays 40 ms, then returns a synthetic source plus
`output.content.candidates: []`. Two warmups and seven measured runs per
implementation alternate execution order. Every run asserts identical complete
JSON, 790 bytes, four calls, and peak concurrency one/two. Reports include each
sample, median/min/max, source/output SHA-256, and the observed median ratio;
there is deliberately no wall-clock pass threshold or promised production gain.

```bash
mkdir -p .runtime/tmp
git show 5a384e320795:packages/cli/src/research-scout-client.ts \
  > .runtime/tmp/research-scout-serial.ts
node packages/cli/scripts/benchmark-research-scout-batch.mjs \
  .runtime/tmp/research-scout-serial.ts
pnpm test:assistant:live -- --test \
  'shares relevant learning without an open decision and suppresses repeated research'
```

The parent reviews the actual reply and unchanged managed-research call/write
assertions, owns Git/PR/CI, and records exact-head evidence. Changelog item:
`2026-09-11 · faster-research-checks`; its PR references remain empty until a PR
exists. Patterns/Knowledge sizing, query timing, diagnostics, runner retirement,
and experiment projection remain out of scope.
