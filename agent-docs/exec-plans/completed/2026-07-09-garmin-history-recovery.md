# Make Junction historical sync recover per resource

Status: completed
Created: 2026-07-09
Updated: 2026-07-10

## Goal

- Make Junction-backed historical sync self-heal without vendor support when
  one resource family (especially Garmin sleep) is still missing after another
  family (such as activity) has imported successfully.

## Success criteria

- Historical progress cannot be marked complete by an unrelated resource.
- Missing eligible resources retain a bounded, durable recovery obligation
  that the existing device-sync scheduler can derive after restart/hydration.
- Recovery reuses the existing provider job, scheduling, metadata, and
  idempotent import seams; it adds no service, queue, or second state owner.
- Existing successful/empty/exhausted retry behavior remains bounded and
  compatible with previously persisted connection metadata.
- Focused regression tests reproduce the partial-history failure and prove
  recovery; package verification, typecheck, direct scenario proof, and all
  routed completion audits pass.

## Scope

- In scope: Junction historical progress semantics, follow-up derivation,
  provider-owned metadata, focused device-sync tests, and matching durable
  documentation when the invariant changes.
- Out of scope: new provider infrastructure, manual support tooling, account
  reconnect/deregistration flows, synthetic sleep data, frontend changes, and
  unrelated webhook-carrier limits without evidence that they caused this
  incident.

## Constraints

- Technical constraints: preserve push-primary Garmin sleep carriers, the
  unconditional rolling pull floor, bounded windows/retries, stable job
  idempotency, source projection ownership, and canonical writes through core.
- Product/process constraints: default to deletion and simplicity, persist
  only the minimum versioned provider-owned state, preserve unrelated work,
  redact identifiers, and finish through the scoped worktree/PR workflow.

## Risks and mitigations

1. Risk: treating legitimately empty optional resources as permanent failures
   can create an unbounded polling loop.
   Mitigation: keep the existing bounded retry ladder and make terminal state
   explicit per tracked obligation.
2. Risk: changing metadata shape can strand connections created by older code.
   Mitigation: derive a safe legacy interpretation and test hydration from the
   currently persisted shape.
3. Risk: retries can duplicate records or suppress the normal pull floor.
   Mitigation: reuse stable window dedupe keys and idempotent external resource
   identities; never move the rolling floor later.

## Tasks

1. Trace current Junction job, metadata, scheduler, and test contracts; write a
   failing partial-history regression.
2. Choose the smallest resource-aware progress representation compatible with
   existing metadata and implement it at the Junction provider boundary.
3. Prove partial success, empty retry, exhaustion, restart hydration, and
   ordinary complete-history behavior with focused tests.
4. Update the durable ingestion/backfill documentation if the contract changes.
5. Run scoped verification, direct scenario proof, required specialist audits,
   parent final review, scoped commit, PR review loop, and merge-conflict proof.

## Decisions

- The recovery owner remains `packages/device-syncd`; no vendor-support or
  operator action is part of the correctness path.
- A provider cannot create data the upstream account never exposes, but Murph
  must keep retrying any still-unverified historical obligation within its
  bounded policy and import asynchronously delivered records whenever they
  arrive.
- Completion is derived in memory from fresh `(source provider, resource)`
  availability and useful records. No per-resource map or second state owner
  is persisted.
- One scalar coverage-policy version lazily reopens legacy terminal outcomes;
  the existing exact-window retry metadata remains the only durable recovery
  state and the existing ladder remains the only retry owner.
- An incomplete delayed pass uses Junction's provider-scoped historical-pull
  endpoint after all timeseries continuations finish. The initial connect pass
  does not duplicate Junction Link's export request, and trigger failures are
  logged without identifiers while the bounded ladder still advances.
- Resource-aware completion applies only to the connect-time historical
  window. Manual and connection-event backfills retain their established
  any-useful-record stop condition and do not inherit the connect repair
  policy.

## Verification

- Commands to run: focused Vitest while iterating; `pnpm test:diff` for every
  touched owner; direct provider-job scenario; privacy/diff checks; routed
  security-privacy and coverage-write audits; PR ReviewGPT loop.
- Expected outcomes: no unrelated resource can satisfy sleep history, retries
  remain bounded and restart-safe, all selected checks pass, and no sensitive
  identifier appears in the diff.

## Verification results

- Device-sync typecheck passed.
- Device-sync coverage passed: 40 files, 727 tests, 88.91% statements and
  79.35% branches.
- Focused provider tests proved source/resource isolation, provider
  allowlisting and deduplication, trigger failure, cancellation, legacy repair,
  hosted metadata precedence, non-connect behavior, and redacted diagnostics.
- All 14 affected workspace typechecks passed. The full affected-workspace test
  gate stopped on an unchanged assistant CLI cold-import timing test at its
  fixed 30-second limit; the isolated failing test passed on rerun.
- Security/privacy, coverage-write, and parent simplicity reviews found no
  remaining medium-or-higher issue.
Completed: 2026-07-10
