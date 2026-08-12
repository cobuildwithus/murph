# Make Junction historical sync frequency-aware

Status: active
Created: 2026-08-11
Updated: 2026-08-11

## Goal

- Let members recover older valid low-frequency Junction health history when
  they connect a source, while keeping dense streams on the existing bounded
  recent window.
- Extend the existing sparse-history owner instead of adding a queue,
  lifecycle, or second source of truth.

## Success criteria

- Every configured sparse wellness resource receives the summary-history
  window only when a persisted admitted source advertises that resource.
- Existing sources receive one rollout migration ending at the current day;
  blood pressure retains its source-first-seen anchor and exact per-reading
  completion proof.
- Daily-aggregate resources complete after a successful canonical import even
  when several upstream rows reduce to one observation; malformed/no-op rows
  stay on the bounded retry ladder.
- Dense timeseries, explicit window overrides, source authority, account
  serialization, and one-day continuation windows remain unchanged.
- Focused tests, affected typechecks, exact-head CI, and both required
  ReviewGPT gates pass.

## Scope

- In scope: Junction backfill policy, per-resource coverage metadata, scheduler
  and completion behavior, focused device-sync tests, owning documentation,
  and the member-facing changelog.
- Out of scope: new resources, importer schema changes, workout history,
  clinical-alert admission, new queues, database schema, and runtime
  configuration changes.

## Constraints

- Technical constraints: reuse the existing source-scoped sparse-history job,
  one-day provider windows, retry ladder, and connection metadata merge path.
- Product/process constraints: keep the policy declarative, preserve strict
  authority checks, avoid raw provider payloads in evidence, and ship through
  the isolated worktree/PR lane.

## Risks and mitigations

1. Risk: aggregate resources never finish because many provider rows can
   collapse into one canonical event.
   Mitigation: declare completion semantics per resource and keep blood
   pressure on exact record reconciliation.
2. Risk: daily scheduler runs create new migration identities before coverage
   persists.
   Mitigation: use a stable policy-version identity for rollout-anchored
   resources.
3. Risk: the longer window increases provider request volume.
   Mitigation: retain source/resource capability gates, one-time coverage,
   per-account serialization, one-day fetch continuations, and the explicit
   override.

## Tasks

1. [completed] Add failing scheduler and completion tests for every sparse policy member.
2. [completed] Replace the two-resource special case with one typed sparse-history policy.
3. [completed] Extend the generic coverage metadata merge owner to all policy resources.
4. [completed] Update owning behavior docs and add a concise public changelog item.
5. [completed] Run focused verification and inspect the candidate diff for privacy and
   simplicity.
6. [pending] Commit, push, open the PR, run CI and both ReviewGPT lanes, then apply and
   verify accepted findings or returned patches.

## Decisions

- The default sparse window is the existing summary backfill window (180 days
  in production), so an explicit timeseries override continues to govern all
  resources in tests and local configurations.
- The new resource set already normalizes to compact daily aggregates; this
  task changes retrieval policy, not persistence grain.
- Blood pressure remains source-first-seen and exact per reading. Notes remain
  successful-fetch complete because empty tags are an intentional no-op.

## Verification

- Commands to run: focused Vitest files for sparse history and metadata merge;
  `pnpm test:diff` for all changed paths; changelog fragment proof; exact-head
  required GitHub checks; preliminary completion-specialists and final
  ReviewGPT.
- Expected outcomes: all checks green, no unresolved review findings, and no
  unscoped or repeated sparse-history jobs after coverage is recorded.
- Pre-fix proof: the focused Junction backfill file failed both new tests
  because no sparse daily resource job existed.
- Current focused proof: the Junction backfill file passes 64 tests, and the
  historical metadata file passes 6 tests, including source-scoped bitmask
  union and future-version immutability.
- The four changelog suites pass 56 tests, and the Web typecheck passes.
- The first diff-aware verification run stopped on a readonly test-fixture
  list passed to the mutable provider config. Copying that list resolved the
  boundary; the device-sync package typecheck and all 64 focused backfill tests
  pass afterward.
