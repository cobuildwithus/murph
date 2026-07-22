# Overnight deterministic vault maintenance

Status: completed
Created: 2026-07-22
Updated: 2026-07-22

## Goal

- Let the existing hosted overnight memory turn invoke narrowly approved,
  deterministic vault-maintenance CLI tools after its memory pass.
- Ship the first tool as a dry-run-first historical Junction evidence repair
  for redundancy that predates PR #842, without manual file editing or broad
  filesystem authority.

## Success criteria

- The overnight turn can use only the existing memory commands plus the exact
  approved maintenance command; it still cannot explore other vault or runtime
  state, contact external services, or send a message.
- Historical cleanup preserves receipts, provenance, output locators, novel
  event/sample associations, event-revision baselines, and ambiguous or
  incomplete evidence, while explicitly marking any row whose evidence was
  filtered so future device replay cannot treat it as a complete delivery.
- The repair is dry-run by default, bounded, idempotent, canonical-lock owned,
  atomically committed, schema/integrity validated, and metadata-only audited.
- Foreground preemption and failed maintenance remain safe: a committed repair
  is not replayed as an unfinished occurrence, and a rejected/partial command
  cannot corrupt canonical vault state.
- Focused production-path coverage, canonical diff verification, acceptance,
  required completion audits, CI, and ReviewGPT all pass.

## Architecture

- `packages/core` remains the sole owner of integration-ingest evidence and the
  historical repair. The CLI only validates explicit apply authority and calls
  that owner.
- The integration-ingest record gains one optional explicit filtered-evidence
  marker. Current filtered device ingests set it, historical repair sets it,
  and replay treats both that field and the legacy deterministic filtered id as
  partial evidence. This removes inference from rewritten row shape while
  keeping already-written PR #842 records readable.
- Eligibility is derived from canonical Junction ingest/event history. There
  is no per-vault task table, generic scheduler, new queue, or maintenance DSL.
- The existing managed overnight automation stays the one orchestration point.
  Its prompt and command classifier add only the named deterministic repair
  command; future commands can follow the same explicit allowlist pattern.

## Safety rules

- Never remove a part unless an earlier same-month, same-provider/account exact
  fingerprint already preserves it and all of its event/sample associations.
- Skip accountless rows, incomplete output maps, invalid history, already
  ambiguous ownership, and parts associated with multi-revision events.
- Keep every ingest row, receipt, provenance object, count, sample locator, and
  event locator. Remove only proven-redundant parts and their matching event
  role references.
- Apply under the canonical write owner with expected-content proof and an
  audit record containing paths/counts/bytes only, never evidence content or
  identifiers.
- Keep batches finite and rerunnable; stop on any validation or continuation
  failure.

## Tasks

1. Add the explicit filtered-evidence contract marker and update current device
   import replay/write behavior with focused regression coverage.
2. Implement the conservative historical Junction evidence repair in core and
   expose its bounded dry-run/apply CLI surface.
3. Add the approved command to overnight managed instructions, maintenance
   prompt constraints, and non-replayable-command detection.
4. Update the command, vault-layout, device-ingestion, and hosted-runtime docs.
5. Run focused direct proof, canonical diff/acceptance verification, required
   coverage audit, parent final review, scoped finish-task commit, PR CI, and
   the ReviewGPT loop through `ROUND_OUTCOME: PASS`.

## Verification

- `pnpm test:diff <touched paths>`
- Built CLI dry-run/apply/idempotency scenario against a synthetic vault
- `pnpm verify:acceptance`
- Required `coverage-write` audit
- PR ReviewGPT loop and green CI

## Progress

- Isolated worktree created from current `origin/main`.
- Base inspection confirmed PR #843 compresses portable staging only; it does
  not mutate source vault history or expose an overnight maintenance command.
- Root-cause trace confirmed historical row filtering needs explicit partial
  evidence semantics to avoid re-inflation on future device replay.
- Added the explicit filtered-evidence marker, conservative core repair,
  dry-run-first CLI surface, and exact overnight command allowlist.
- Proved dry-run, apply, validation stability, idempotency, and no-op behavior
  against a disposable copy of the supplied vault without persisting private
  vault contents in the repository.
- Required `coverage-write` review completed; its changed-surface gaps were
  addressed with focused core, CLI, audit, and replay regression tests.
- `pnpm test:diff $(git diff --cached --name-only)` passed.
- `pnpm test:scenario-integrity` and the focused scenario-manifest diff lane
  passed after adding the command scenario manifest.
- `pnpm verify:acceptance` passed, including package coverage, package
  boundaries, the production web build, and Cloudflare worker verification.
- Remaining: scoped finish-task commit, PR CI, and ReviewGPT through
  `ROUND_OUTCOME: PASS`.
Completed: 2026-07-22
