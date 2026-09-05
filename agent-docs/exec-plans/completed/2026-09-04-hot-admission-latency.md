# Hot admission latency investigation

## Outcome and invariants

Simplify mailbox acceptance to native Codex turn start for an already-running
workspace. The current task prioritizes maintainable ownership and deletion of
redundant work; the earlier 50% reduction is no longer the completion target. Preserve authenticated mailbox ownership,
accepted-input durability, foreground priority, replay safety, provider-change
handoff, prompts, and the existing timing anchor. Do not count model generation
or final delivery as admission time.

Web owns mailbox acceptance and delivery authority. The Cloudflare adapter owns
wakes and fencing. Assistant runtime owns import and foreground scheduling;
assistant engine owns accepted inputs and the Codex boundary.

## Current work

- [x] Add an opt-in benchmark through the existing hosted-local harness.
- [x] Inspect production timing aggregates and the owners of the largest spans.
- [x] Identify and repair the missing detailed timing context on hot imports.
- [x] Finish current-state focused verification of the complete candidate.
- [x] Remove redundant mailbox transaction and duplicate ingress root validation.
- [x] Avoid unchanged routing encryption/writes while preserving routing repair.
- [x] Reuse validated input records and make session preflight observational.
- [x] Gate optional mailbox presentation work with the existing usage-eligibility predicate.
- [x] Reconcile provider lifecycle ownership and verify the earlier safe fixes.
- [x] Review the full candidate and report focused verification and remaining gaps.

Paired Docker measurements remain optional performance evidence, not a reason
to claim gains or an obligation to hit the retired reduction target.

Implementation, focused verification, and parent review are complete. This plan
is closed with the scoped local task commit.
No latency reduction or production savings have been demonstrated. No push, PR,
deployment, or production mutation is part of this completion.

## Read-only production follow-up

Observation window: preceding 24 hours, queried on UTC 2026-09-05. Primary facts
came from bounded queries through `murph-prod-psql-ro`; runtime diagnostic
aggregates used the separate `murph-prod-runtime-logs-psql-ro` database. No rows
were copied between databases. Web request timing came from explicitly scoped
production Vercel logs. Expanded Vercel log rows were deduplicated by request
trace before aggregation; raw logs and identifiers were not retained.

There were 53 completed warm Linq traces with an accepted active wake. Their
median intervals were:

| Interval | Median ms |
| --- | ---: |
| Stored acceptance anchor to Codex start | 1862 |
| Stored acceptance anchor to staged input | 1003 |
| Staged input to Codex start | 639 |
| Stored acceptance anchor to Temporal signal acceptance | 413 |
| Wake wait resolved to foreground import | 135 |
| Foreground import start to decode start | 193 |
| Decode | 57 |
| Pending reply admitted to execution acceptance | 524 |
| Execution acceptance to Codex start | 52 |

These are independent medians, not an additive waterfall. Tail cases, active
steering, attachments, and new thread starts need separate attribution. Thread
resume was about 30 ms median in 46 applicable warm traces. Supplementary
provider-plan diagnostics across 365 requests showed 28 ms median route
planning; that broader population is not the same warm-input cohort.

### Acceptance is a transaction-start anchor

All 53 inspected acceptance anchors equaled the associated mailbox `created_at`.
The deployed column default is `CURRENT_TIMESTAMP`; the insert omits an explicit
`created_at`. This records PostgreSQL transaction start, before the mailbox
commit finishes. The acceptance-to-signal interval therefore includes remaining
transaction work and cannot be attributed entirely to Temporal.

In 50 distinct production request traces that completed an eligible direct
wake, the actual wake-handoff span was 46 ms median (65 ms mean), while the
broader planner span was 619 ms median. These request traces are supplementary,
not a row-matched subset of the 53 warm traces. Source owners:

- `apps/web/src/lib/hosted-mailbox/store.ts`: mailbox insert/default timestamp.
- `apps/web/src/lib/hosted-runtime-latency/store.ts`: acceptance from mailbox creation.
- `apps/web/src/lib/hosted-onboarding/webhook-service-wake.ts`: handoff timing and
  direct wake after durable Temporal acceptance.
- `apps/web/src/lib/hosted-orchestration/signal-runtime.ts`: fresh active-access
  check and signal-with-start. Keep this authority and durable ordering intact.

### Detailed timing was absent on the hot path

Detailed additive pre-provider timing was present on only one of 54 completed
warm traces, and absent on the 53 accepted active wakes. Source inspection found
that the initial mailbox import creates a provider-start timing context, while
`runForegroundMailboxWakeIfWork` did not create one for later imports. Existing
stamp helpers return null without that context, leaving the automation,
assistant-service, and provider-plan/gate subdivisions absent on hot turns.

The patch creates a fresh context immediately after each hot import that yields
assistant inputs, then forwards it through the existing foreground-pass helper.
It reuses the existing monotonic timer, boundaries, and telemetry contracts.
It does not reuse the invocation's earlier anchor or change execution ordering.
The existing checkpoint-wake fallback regression now asserts that the new
input's import, foreground-pass, workspace-pass, and assistant callback
boundaries are present and ordered. This is an observability fix, not a proven
latency reduction. Its next production trace should narrow the remaining
pending-to-execution wait without speculative auth or durability changes.

## Earlier candidate and local benchmark

The earlier speculative overlap has been removed. Mailbox fetch is not purely
read-only: a denied usage read can confirm denial through bookkeeping and stamp
mailbox denial metadata. No provider-specific denial regression was established,
but starting this work before a would-handoff return adds concurrency and effects
without measured benefit. The original provider-check-before-prefetch ordering
and its unchanged regression tests are retained. The detailed timing fix remains.

`pnpm hosted-local e2e hot-admission-latency` is manual-only and excluded from
`e2e all`. It uses deterministic provider stubs with native Codex, discards two
warmups, checks the same runtime attempt, and waits for pass completion before
each next message. It accepts an ignored private vault fixture and prints only
content-free timings. The private export lacks accumulated Codex session state.
Only use `--no-bundle` for a deliberately prepared matching baseline or candidate.

Repeated Docker attempts did not reach measured messages. The x86 runner and
object-store mirror were emulated in an ARM VM. Native local images avoided the
runner subreaper failure, but full-stack startup still stalled in context
transfer and readiness. Under that contention, the MinIO monitor's two-second
readiness failure entered cleanup/restart, then hit a replacement name conflict.
No OOM cause or external termination was established.

A competing benchmark was traced to a live separate agent and left untouched.
This session's diagnostic attempts were stopped, remaining owned descendants
were verified and sent SIGTERM, temporary Dockerfile/logging edits were restored,
and duplicate generated residues were removed only after byte equality checks.
A subsequent Docker listing contained only pre-existing containers. Do not
restart or stop another agent's services to obtain cleaner timings.

## Verification record

Earlier source version: 94 causal-input, scheduling, and foreground-input tests
passed, as did assistant-runtime typecheck. Harness routing tests (16), harness
and Cloudflare typechecks also passed. These precede the continuation edits.

The provider-overlap regression replaced a 100 ms sleep with a bounded barrier.
Two current candidate runs passed its overlap and pre-import assertions, but
failed existing 650 ms handoff deadlines (first: four pass/one fail; second:
two pass/three fail). The unchanged baseline source and tests were then run
with the same focused command: all five timed out at 15 seconds, with two
teardown-related unhandled errors. Total baseline duration was 488 seconds,
including 400 seconds of imports. Baseline failure demonstrates that the local
run is unstable; it does not turn the candidate suite green. Candidate files
were restored after the baseline comparison.

Latest instrumentation patch:

- `pnpm --dir packages/assistant-runtime typecheck`: passed.
- `pnpm complexity:diff`: passed, aggregate complexity debt unchanged.
- `git diff --check` and task-file local-identifier scan: passed.
- Focused foreground checkpoint-wake regression: passed (one selected test,
  19 skipped). Command: `pnpm --dir packages/assistant-runtime exec vitest run
  --config vitest.config.ts test/hosted-runtime-workspace-entrypoint-foreground-input.test.ts
  -t "falls back to a foreground refetch when checkpoint wake classification fails"
  --testTimeout=30000 --isolate=true --no-coverage`. The runtime scenario took
  10.7 seconds; test-graph import still took 229 seconds on this host.

No timing assertions were relaxed. The earlier missing local proof is
superseded by the current verification record below; paired Docker performance
proof remains unavailable. This internal diagnostic
work does not change member-facing behavior and does not need a changelog entry.


## Final implementation and review

The five reviewed simplifications are implemented at their existing owners:

- Mailbox projection executes its unchanged single SQL statement directly. It
  no longer opens an interactive transaction or delegates to a one-use wrapper.
- Prepared direct ingress delegates root locking/revalidation to mailbox append;
  Linq still checks the prepared member/domain and translates root drift into
  its existing bounded preparation retry.
- Unchanged home bindings skip private-column encryption and the routing upsert
  only after the existing member/chat locks and conflict cleanup. Changed keys,
  missing ciphertext, pending clears, and assignment changes still write.
- Accepted-input validation returns its validated event records for video
  attachment authority. Entry validation, fresh validation after the turn lock,
  journal durability, and later steer validation remain at their boundaries.
- Session preflight uses the existing resolver without persisting a speculative
  binding. It retains the storage lock for projection recovery and corrupt
  session quarantine; authoritative admission still persists the binding.

Mailbox usage and optional sponsorship presentation now share the existing
conversation-work eligibility predicate. Empty, consumed, and system-only
batches omit the optional presentation read. No broader access-fact cache or
cross-owner authority snapshot was introduced: those reads have different
owners and lifetimes and were not proven redundant.

Provider configuration remains a lifecycle check needed for missed settings-wake
recovery. The protocol and invariants now describe this consistently. The
original provider-check-before-prefetch ordering remains because fetch may
perform usage-denial bookkeeping. The detailed hot-import timing repair remains
and changes no acceptance timestamp, counter, prompt, or execution ordering.

Parent review covered the complete source diff, benchmark, and changed tests;
separate web and engine reviews checked their authority and recovery paths.
Continuation found stale automation test mocks for the new session lookup and
repaired both suites. Added preflight tests exercise routing-projection repair
and corrupt-session quarantine. No additional production-code change was needed
in this continuation. There are no new dependencies, services, durable state,
wire formats, or deployment ordering requirements.

## Current verification (2026-09-05)

- Web: `pnpm --dir apps/web test -- test/hosted-mailbox-store.test.ts
  test/hosted-member-routing-linq-binding.test.ts
  test/hosted-onboarding-linq-dispatch.test.ts
  test/hosted-runtime-internal-routes.test.ts`: 376 tests passed.
- Runtime: `pnpm --dir packages/assistant-runtime exec vitest run --config
  vitest.config.ts --no-coverage --maxWorkers=1 --no-file-parallelism
  test/hosted-runtime-workspace-entrypoint-causal-input.test.ts
  test/hosted-runtime-workspace-entrypoint-foreground-input.test.ts
  test/hosted-runtime-workspace-entrypoint-scheduling.test.ts`: 94 tests passed,
  including the previously failing checkpoint deadline with no relaxed timeout.
- Harness: `pnpm --dir packages/hosted-local-harness exec vitest run --config
  vitest.config.ts --no-coverage test/e2e-suite.test.ts`: 16 tests passed.
- Engine: eight focused files passed, covering accepted-input journaling, video
  authority, local-service live input, persistence, preflight, and both automation
  suites. The two runs passed 123 and 307 tests (six repeated preflight cases):
  424 distinct tests. Commands used `pnpm --dir packages/assistant-engine exec
  vitest run --config vitest.config.ts --no-coverage` with the named test files.
- Total: 910 distinct focused tests passed across the affected owners.
- Typechecks passed for `apps/web`, `apps/cloudflare`,
  `packages/assistant-engine`, `packages/assistant-runtime`, and
  `packages/hosted-local-harness` using
  `pnpm --dir <package> typecheck`.
- `pnpm complexity:diff`: passed; aggregate measured debt decreased by three.
  Existing large runtime/ingress owners retain their authority and ordering;
  no split or abstraction is justified solely by their reported size.
- Task-file identifier scan and `git diff --check`: passed.

The optional native-Codex Docker benchmark is typechecked and its manual-only
harness routing is verified; paired performance measurements have not run
successfully. No production speedup is claimed. Local proof does not substitute
for required exact-head CI and routed ReviewGPT if a PR is subsequently opened.
This is internal execution cleanup with no member-visible contract or prompt
change, so no changelog item or real-model behavior test is required.
Status: completed
Updated: 2026-09-05
Completed: 2026-09-05
