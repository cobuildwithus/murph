# Junction hourly import write amplification

Status: active
Created: 2026-08-26
Updated: 2026-08-26

## Goal

- Make bounded Junction hourly fallback reconciliation converge with fewer
  canonical writes while preserving exact continuation progress, foreground
  preemption, provider request limits, and canonical import ownership.

## Success criteria

- A production-shaped synthetic test proves that several consecutive hourly
  windows can be fetched serially and committed through one canonical import.
- The canonical import boundary advances only through the last completed
  window. A hosted yield retains the current cursor, a later-hour retryable
  provider failure resumes at that failed hour, and a classified optional
  response consumes exactly its own hour without discarding an earlier prefix.
- Provider requests remain serial and bounded; no new fanout, transaction, or
  persisted-state owner is introduced.
- Focused provider, service, importer, and hosted-runtime tests and affected
  typechecks pass, followed by the required exact-head review and CI gates.

## Scope

- In scope: Junction hourly timeseries fallback execution, focused synthetic
  coverage, metadata-only timing evidence, and deployment/live recovery proof.
- Out of scope: resource-policy changes, a second queue or scheduler, longer
  hosted pass deadlines, canonical state outside the existing importer, and
  manual production queue mutation.

## Constraints

- Preserve one source of truth for canonical health data under `packages/core`.
- Keep provider requests sequential and within the existing collection work
  limit; evaluate composed maximum request and record counts explicitly.
- Do not mark completed records durable until their combined snapshot is
  imported. Keep the import and continuation boundaries distinct when one
  classified optional hour is intentionally consumed without an import.
- Keep runtime diagnostics metadata-only and free of member, payload, provider
  record, credential, and filesystem identifiers.

## Risks and mitigations

1. Risk: coalescing windows could skip an hour after interruption.
   Mitigation: advance the continuation only after one successful canonical
   import covering the complete fetched prefix; propagate hosted aborts before
   import, consume only the exact classified optional hour, and add
   interruption and optional-response regression coverage.
2. Risk: a larger in-memory snapshot could exceed canonical record limits.
   Mitigation: use a small fixed window count derived from the existing
   one-hour provider bound and retain existing per-resource sanitization and
   canonical caps.
3. Risk: extra provider fanout could raise peak load.
   Mitigation: keep requests strictly serial, cap attempts per job, and replace
   the same total hourly requests rather than adding requests.

## Tasks

1. [x] Prove the remaining cost is canonical write amplification rather than
   provider retries, queue failure, or event-index rescanning.
2. [x] Add a synthetic failing reproduction for bounded hourly coalescing and
   exact continuation behavior.
3. [x] Implement the smallest provider-owned coalescing change.
4. [ ] Run focused verification, affected typechecks, privacy/diff review, and
   complete the Product UX walkthrough.
5. [ ] Commit, push, run specialist/final review with required CI, deploy, and
   prove live mailbox recovery.

## Decisions

- Product UX Patch: connected-health catch-up becomes faster in the background;
  no control, copy, permission, provider selection, or visible state changes.
- Outcome: dense connected-device history reaches Murph with fewer repeated
  background commits and unchanged data coverage.
- Reaches: the existing connected-health catch-up journey after a page-heavy
  provider day falls back to hourly windows.
- Proof: provider-shaped rich, yield, and retryable-failure scenarios prove
  import count, exact durable cursor behavior, classified optional-hour
  consumption, and unchanged source coverage; live post-deploy evidence must
  prove the stalled mailbox lane converges.
- Accepted final-review finding: the first candidate conflated its import and
  continuation boundaries after a later optional response. The corrected
  candidate carries those coordinates separately in memory, imports the valid
  prefix, and consumes only the classified optional hour.
- Rejected: increasing the hosted timeout. It would hide the repeated-write
  cost and weaken foreground responsiveness without reducing work.
- Rejected: changing resource admission or deleting queued work. That would
  alter product data coverage instead of correcting throughput.
- Rejected: a pass-wide uncommitted canonical batch. Queue durability requires
  each completed job to own a committed canonical prefix.

## Verification

- Add focused Junction provider/service tests for serial request count,
  combined import count, terminal cursor, yield-before-commit replay, and
  retryable and optional provider-failure replay.
- Run the narrow affected Vitest files and package typechecks first; expand only
  when direct evidence or CI requires it.
- Measure the synthetic path before and after using deterministic import and
  request counts rather than wall-clock thresholds.

## Product UX walkthrough

- A member with dense connected-device history keeps the same sources and data
  coverage, while background reconciliation performs fewer canonical commits.
- A sparse-history member follows the unchanged daily path.
- A foreground message or hosted timeout still interrupts between bounded work
  units without a post-yield canonical write or falsely completed device-sync
  wake.
- Provider failure preserves the exact last committed cursor and ordinary
  retry ownership.
- A classified optional response retains its diagnostic metadata, never drops
  an earlier valid prefix, and never consumes an unrequested later hour.
