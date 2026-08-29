# Trace accepted input execution

Status: completed
Created: 2026-08-27
Updated: 2026-08-29

## Goal

- Add the smallest behavior-preserving telemetry needed to identify where an
  accepted, staged private Linq input can disappear between pending admission,
  acceptance for provider execution, and a durable reply/non-reply outcome.

## Success criteria

- The telemetry answers one bounded question: for a staged input without a
  provider start, reply attempt, delivery, or terminal non-reply, was pending
  admission completed, was the input accepted at the common provider boundary,
  or was it lost between those owner transitions?
- The accepted ReviewGPT implementation reuses the existing ingress-latency
  trace, its authenticated write fence, and the current assistant-input
  correlation ID; it adds no functional branch, new store, scheduler, queue,
  migration, retention rule, or user-visible behavior.
- Focused contract/parser/store/runtime tests, affected typechecks, privacy
  checks, completion reviews, and exact-head CI pass.
- An eligible telemetry-only PR is deployed only if every autonomous gate is
  satisfied; otherwise it remains Ready with the exact human action recorded.

## Scope

- In scope: typed lifecycle milestones at pending-admission and the common
  accepted-for-execution boundary, existing ingress-latency trace persistence,
  focused tests, and the durable observability contract.
- Out of scope: device sync, provider retry policy, production repair/replay,
  mailbox or database schema/migrations, functional terminalization changes,
  new schedulers/queues/state owners, and messaging behavior.

## Constraints

- Technical constraints: extend only the existing bounded latency trace with
  typed timestamps on rows that already exist; use the current safe opaque
  assistant-input identifiers and authenticated runtime attempt fence; preserve
  existing volume, retention, database-load, and deployment owners.
- Product/process constraints: Product UX Patch investigation. The telemetry
  itself is invisible and behavior-preserving; its future read determines which
  owner must restore the existing accepted-message promise.
- ReviewGPT exclusively authors production implementation and remediation. The
  local owner will apply only an exact inspected ReviewGPT patch.

## Risks and mitigations

1. Risk: Lifecycle telemetry could alter the hot reply path or fail the turn.
   Mitigation: use the existing best-effort trace writer and prove failures are
   swallowed without changing selection, provider, checkpoint, or retry flow.
2. Risk: Per-input telemetry could leak private content or create unbounded
   cardinality/cost. Mitigation: permit only existing opaque correlation IDs,
   timestamps, source enum, and bounded milestone enum; no content, route,
   identity, health value, payload, or new row.
3. Risk: Vercel/Cloudflare version skew could reject a new milestone.
   Mitigation: follow the existing trace contract's declared compatibility and
   deployment order, retaining old-event compatibility and a safe rollback.
4. Risk: Private production evidence could leak into tests or review packets.
   Mitigation: use only synthetic messages and opaque fixture identifiers; carry
   production evidence as bounded counts, phases, and relative ordering.

## Tasks

1. Finish deduplication and exhaust existing evidence for the staged-input gap.
2. State the exact telemetry question and competing hypotheses, then give
   ReviewGPT the privacy-safe implementation packet.
3. Inspect the exact ReviewGPT patch for question agreement, simplicity,
   privacy, cardinality, cost, hot-path safety, and deploy compatibility.
4. Apply only the accepted patch and run focused deterministic, typecheck,
   privacy, Product UX, and failure-path proof.
5. Commit, push, open the PR, run preliminary specialists and final ReviewGPT
   concurrently with CI, then use the telemetry-only merge/deploy exception
   only if every gate is satisfied.

## Decisions

- The selected investigation outranks provider/platform retries because it is a
  current user-critical accepted-input gap with exact durable exposure and no
  active owner.
- Existing evidence proves staging and the missing durable outcome, but it does
  not distinguish pending-admission loss, accepted-execution loss, and an
  automation terminalization gap. A direct index-backfill hypothesis was
  rejected by a focused passing reproduction, so functional code is not safe
  to change yet.
- Do not repair production state or send a message; the run remains read-only.
- No new Frog entry: the observed failure is production behavior, which Frog
  explicitly excludes, and dependency setup followed the documented worktree
  path.
- Accepted the preliminary coverage finding and applied ReviewGPT's test-only
  remediation exactly: the assembled Linq first-contact journey now requires
  both milestones to survive Cloudflare-to-Web PostgreSQL persistence.
- The focused hosted-local journey cannot start on this macOS checkout because
  the repository's absolute runner-bundle budget fails by 36,565 bytes before
  Vitest; the authoritative Linux production-bundle check passed on the first-
  reviewed head, and no guard was bypassed.
- Final ReviewGPT round 1 returned one accepted High finding: the initial
  foreground-selector callback does not observe live steering or background
  recovery, and the same-attempt fence rejects a newer recovery attempt. The
  resulting absence can misclassify an input as not selected after it was
  accepted for provider execution. Remediation must move the observation to the
  existing common accepted-input boundary, use the existing lease-generation
  transfer rule, and delete the incomplete selector callback plumbing.
- Accepted ReviewGPT remediation v2 exactly. It deletes the selector-only
  callback/emitter, records `assistant_input_accepted_for_execution` from the
  existing `beforeProviderAcceptedInputs` owner, reuses the event already read
  to resolve the current input, and adds no second vault read, new service,
  queue, schema, or state owner. Supported source/input pairs are grouped;
  unsupported inputs do not suppress supported ones.
- Warm old-runner compatibility remains explicit: the legacy
  `foreground_input_selected` event, parser value, and trace leaf remain valid
  with their original exact-attempt semantics. The new acceptance event uses
  the existing monotonic lease-generation transfer only for unresolved
  lifecycle milestones; the legacy event is not translated into acceptance.
- Accepted three ReviewGPT test-only corrections exactly. They update one route
  call count and remove two fixture assumptions that were not architectural
  proof. The existing background-selection boundary test plus the entrypoint
  acceptance/failure-isolation test now provide the smaller composable proof.

## Verification

- Commands to run: focused hosted-execution parser/contract, Web latency-store
  and route, runtime import/acceptance and Cloudflare bridge tests; affected
  package typechecks; `git diff --check`; privacy and provider-boundary guards;
  preliminary `completion-specialists`; final ReviewGPT; exact-head required
  GitHub checks.
- Expected outcomes: existing events remain accepted across version skew; new
  milestones update only already-matched trace rows; unmatched inputs are a
  bounded no-op; trace failures do not alter runtime flow; no migration,
  functional behavior, provider call, or device-sync surface changes.
- Completed proof on the first-reviewed head: 33 hosted-execution tests, 187
  assistant-runtime tests, 105 Web tests, affected package typechecks,
  `pnpm logs:guard`, and `git diff --check` passed. On the remediation tree, the
  full hosted-execution suite passed (561 tests); the full assistant-runtime
  suite reached one ReviewGPT test-fixture assertion with 2,535 passing and five
  skipped, and the corrected compositional acceptance/background proof passed
  both named tests. The Web store suite passes; the route suite is currently
  blocked in its shared dynamic-import hook under unrelated host CPU contention,
  after an earlier run reached only the corrected call-count assertion. Exact-
  head typechecks, privacy checks, final ReviewGPT, CI, merge, and deployment
  proof remain pending.

## Later production query

- Query a bounded accepted-time window with the existing fixed row cap and only
  opaque trace/input identifiers. Classify unresolved rows as
  `staged_without_pending_admission`,
  `admitted_not_accepted_for_execution`, or
  `accepted_for_execution_without_downstream_outcome`.
Completed: 2026-08-29
