# Canonical artifact upload concurrency

Status: completed
Created: 2026-07-15
Updated: 2026-07-15

## Goal

- Remove avoidable foreground reply latency from hosted canonical-write
  persistence without weakening its durability, rollback, or recovery
  guarantees.

## Success criteria

- A canonical write prepares and validates its complete immutable artifact set
  before starting any upload.
- Payload, receipt, and receipt-log objects upload with one small fixed
  concurrency bound; the recovery pointer is published only after every
  required upload succeeds.
- If any upload fails, all started uploads settle, no recovery pointer is
  published, and the existing `WriteBatch` failure path remains authoritative
  for local rollback.
- Focused tests prove concurrent start, bounded scheduling, failure draining,
  validation-before-upload, and checkpoint ordering.
- Required verification, coverage audit, green CI, and the exact-head
  ReviewGPT loop complete with no accepted findings.

## Scope

- In scope: the assistant-runtime canonical receipt-log upload owner, its
  workspace-runner call site, focused tests, and the hosted-runtime protocol
  description of the publication barrier.
- Out of scope: background persistence, new queues or state owners, Codex
  process prewarming, artifact-store transport changes, schema changes, and
  unrelated foreground reply work.

## Constraints

- Preserve the synchronous canonical-write commit barrier and status-only
  checkpoint CAS.
- Add no dependency, configuration knob, retry loop, compatibility layer, or
  lifecycle state.
- Keep the implementation local to the existing receipt-log owner and use a
  fixed internal bound.
- Work only on `codex/canonical-artifact-upload-concurrency` in the isolated
  worktree; preserve unrelated active lanes and primary-checkout changes.

## Risks and mitigations

1. Risk: publishing the log pointer before a referenced payload or receipt is
   durable would make cold recovery incomplete.
   Mitigation: return the log ref only after the complete upload barrier
   succeeds; keep checkpoint publication at the existing caller boundary.
2. Risk: fail-fast promises could leave escaped network work after local
   rollback begins.
   Mitigation: settle every upload in the active bounded wave before surfacing
   its first failure, and do not schedule later waves after failure.
3. Risk: unconstrained fanout could trade latency for memory or connection
   pressure on unusually large writes.
   Mitigation: use one fixed small batch size and prove later waves do not start
   early.

## Tasks

1. Register the isolated lane and trace current write, checkpoint, rollback,
   restore, and artifact-store boundaries.
2. Move the complete artifact upload set into the existing receipt-log owner
   and add bounded concurrent upload with settled-wave failure handling.
3. Add focused deterministic tests for concurrency and publication ordering.
4. Run scoped verification, the required coverage-write audit, and parent
   architecture/failure-path review; resolve accepted findings.
5. Close the plan with a scoped commit, push, open the intent-complete PR, and
   run CI plus ReviewGPT to completion.

## Decisions

- Keep persistence synchronous. Backgrounding would let a reply escape before
  the canonical mutation is durably recoverable and would bypass the existing
  `WriteBatch` rollback contract.
- Do not prewarm the app server in this change. That would require a separate
  prepared-turn/process-reservation lifecycle and is not needed to remove the
  measured sequential artifact-upload cost.
- Upload the receipt-log object in the same unpublished artifact wave as its
  referenced objects. Until the existing status checkpoint publishes its hash,
  any partial success is unreachable content-addressed residue, not product
  truth.

## Audit outcomes

- The required independent `coverage-write` pass found no unresolved gap. It
  strengthened the failed-wave test so all eight started uploads must drain and
  the deferred ninth upload must remain unscheduled.
- The first full package run exposed a stale sequential assumption in the
  existing host-abort regression: it checked a shared upload count after an
  await. Capturing the per-call ordinal before the await restores the intended
  concurrent proof; the entrypoint still commits the receipt checkpoint and
  preserves the canonical write before surfacing the host abort.
- Parent final review found no additional owner, lifecycle, retry, schema,
  compatibility, or deployment coupling. The change remains one private
  upload helper plus a smaller runner call site.

## Verification

- `pnpm --dir packages/assistant-runtime exec vitest run --config
  vitest.config.ts --isolate=true --no-coverage
  test/hosted-runtime-canonical-write-receipt-log.test.ts
  test/hosted-runtime-workspace-runner.test.ts`: 109 passed.
- Focused host-abort entrypoint regression: 1 passed, 223 skipped.
- `pnpm test:diff` over the two production files, three focused test files, and
  protocol doc: assistant-runtime 74 files / 1,718 passed / 2 skipped;
  Cloudflare reverse-dependent verification 105 files / 1,833 passed.
- `git diff --check`, identifier-path scan, banned-cast scan, hosted Temporal,
  crypto, log-payload, dependency, workspace-boundary, and package typechecks:
  passed.
- Remaining external gates after the scoped commit: exact pushed-head PR
  preflight, ReviewGPT round(s), PR CI, and mergeability proof against latest
  `main`.
Completed: 2026-07-15
