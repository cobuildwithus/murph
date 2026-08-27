# Trace foreground input admission

Status: active
Created: 2026-08-27
Updated: 2026-08-27

## Goal

- Add the smallest behavior-preserving telemetry needed to identify where an
  accepted, staged private Linq input can disappear between pending admission,
  foreground selection, and a durable reply/non-reply outcome.

## Success criteria

- The telemetry answers one bounded question: for a staged foreground input
  without a provider start, reply attempt, delivery, or terminal non-reply,
  was pending admission completed, was the input selected, or was it lost
  between those owner transitions?
- The accepted ReviewGPT implementation reuses the existing ingress-latency
  trace, its authenticated write fence, and the current assistant-input
  correlation ID; it adds no functional branch, new store, scheduler, queue,
  migration, retention rule, or user-visible behavior.
- Focused contract/parser/store/runtime tests, affected typechecks, privacy
  checks, completion reviews, and exact-head CI pass.
- An eligible telemetry-only PR is deployed only if every autonomous gate is
  satisfied; otherwise it remains Ready with the exact human action recorded.

## Scope

- In scope: typed lifecycle milestones at pending-admission and foreground-
  selection boundaries, existing ingress-latency trace persistence, focused
  tests, and the durable observability contract.
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
  not distinguish pending-admission loss, foreground carry/selection loss, and
  an automation terminalization gap. A direct index-backfill hypothesis was
  rejected by a focused passing reproduction, so functional code is not safe
  to change yet.
- Do not repair production state or send a message; the run remains read-only.
- No new Frog entry: the observed failure is production behavior, which Frog
  explicitly excludes, and dependency setup followed the documented worktree
  path.

## Verification

- Commands to run: focused hosted-execution parser/contract, Web latency-store
  and route, runtime import/selection and Cloudflare bridge tests; affected
  package typechecks; `git diff --check`; privacy and provider-boundary guards;
  preliminary `completion-specialists`; final ReviewGPT; exact-head required
  GitHub checks.
- Expected outcomes: existing events remain accepted across version skew; new
  milestones update only already-matched trace rows; unmatched inputs are a
  bounded no-op; trace failures do not alter runtime flow; no migration,
  functional behavior, provider call, or device-sync surface changes.
