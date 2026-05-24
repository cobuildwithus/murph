# DeepSec high bug clean fixes

Status: completed
Created: 2026-05-24
Updated: 2026-05-24

## Goal

- Fix the agreed DeepSec `HIGH_BUG` slice now: Linq blind-index rotation safety, hosted device-sync fail-closed control-plane behavior, device event reserved-field rejection, and core canonical-write-lock hardening.

## Success criteria

- Linq routing reads existing blind-index versions before rebinding and serializes rebind decisions on a version-stable lock.
- Hosted runtime device sync does not continue scheduler/drain work after authoritative control-plane sync or reconcile failures when hosted control-plane sync is configured.
- Device event payload fields cannot override canonical event identity, source, lifecycle, or other top-level event fields.
- Core import/idempotency revision planning asserts canonical write-lock scope before planning canonical append work.
- Focused regression tests cover the changed behavior, and required verification/audits run or blockers are documented.

## Scope

- In scope:
  - `apps/web` hosted Linq routing/store helpers and focused tests.
  - `packages/assistant-runtime` hosted maintenance control-plane error handling and focused tests.
  - `packages/core` mutations/canonical write-lock hardening and focused tests.
- Out of scope:
  - Token-refresh findings, which the user wants to discuss separately.
  - The pre-existing WhatsApp consent dirty change owned by the active DeepSec `BUG` plan; this plan may verify it but should not rewrite it unless necessary.
  - Broad rewrites or new persisted state.

## Constraints

- Preserve privacy guardrails: no direct personal identifiers, local paths, secrets, provider payloads, account ids, or raw contact values in files, tests, logs, docs, or handoff.
- Preserve unrelated active worktree edits and ledger rows.
- Prefer existing owner-local primitives and transaction boundaries over speculative abstractions.

## Risks and mitigations

1. Risk: Linq privacy fixes can grow into broad routing redesign.
   Mitigation: Reuse existing blind-index read-candidate helpers and add one narrow advisory-lock helper around the affected write decisions.
2. Risk: Hosted runtime maintenance overlaps a diagnostics row.
   Mitigation: Touch only fail-closed control-plane behavior and tests; avoid diagnostic/logging changes.
3. Risk: Existing dirty WhatsApp consent edits overlap the user-requested slice.
   Mitigation: Treat those changes as pre-existing and verify/mention ownership instead of overwriting.

## Tasks

1. Register plan and ledger row.
2. Implement Linq read-candidate and version-stable locking changes.
3. Implement hosted device-sync fail-closed behavior.
4. Implement device event reserved-field rejection and canonical write-lock planning assertion.
5. Add focused tests.
6. Run scoped verification, required audits, and close the plan.

## Decisions

- Token refresh is deferred for a separate design discussion.
- Do not take ownership of the existing WhatsApp consent dirty hunk unless later tests prove it needs a small compatible adjustment.

## Verification

- Commands to run:
  - Focused Vitest tests for changed hosted web, assistant-runtime, and core files.
  - `pnpm test:diff <touched paths>` or the closest truthful scoped lane if unrelated dirty files make raw diff mode too broad.
  - `pnpm typecheck` unless blocked by unrelated pre-existing failures.
  - Required completion audit subagents for security/privacy, coverage, and final review.
Completed: 2026-05-24
