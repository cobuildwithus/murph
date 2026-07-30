# Progress Card Final Review Remediation

Status: completed
Created: 2026-07-30
Updated: 2026-07-30

## Goal

- Finish PR #1102 so a private progress-card image and every required recovery
  reply retain their original response context, target, and durable delivery
  order across steering, retries, restarts, and quarantined outbox records.

## Success criteria

- Late text and media cannot migrate to a newer steered response context.
- Required recovery replies form one exact persisted predecessor chain before
  the final reply, including bubbled replies and cross-turn retries.
- Missing, malformed, ambiguous, or terminal predecessors fail the chain closed
  without blocking unrelated outbox work.
- Focused suites, affected package typechecks, docs checks, the final ReviewGPT
  gate, and exact-head GitHub Actions pass.
- The existing PR is updated without creating overlapping branch or PR work.

## Scope

- In scope: assistant response-context ownership, delivery materialization,
  outbox dependency persistence/resolution, hosted dispatch, pruning, focused
  regressions, runtime rollout documentation, and PR verification.
- Out of scope: nutrition response-card behavior, Assistant Ask disclosure,
  rich-link delivery, authentication lifecycle work, deployment, and merge.

## Constraints

- Technical constraints: preserve ordinary unmarked best-effort replies; use one
  exact predecessor chain as the source of truth; avoid new services or state
  owners; retain provider reconciliation without duplicate sends.
- Product/process constraints: preserve private-media behavior, keep identifiers
  out of artifacts, reuse the existing PR branch, and treat the first admitted
  strict-schema writer bundle as the rollback floor.

## Risks and mitigations

1. Risk: A retry or provider checkpoint mutates the stable sequence identity.
   Mitigation: Persist immutable predecessor IDs and preserve the marked
   idempotency key through pending-confirmation, reconciliation, and sent state.
2. Risk: A corrupt or cross-sequence predecessor contaminates unrelated work.
   Mitigation: Validate exact session/base membership, quarantine only the local
   malformed chain, and recursively retain active ancestors during pruning.
3. Risk: Open PRs touch shared assistant assembly files.
   Mitigation: Refresh open-PR overlap, document distinct ownership, and run
   exact-head CI plus the PR-specific final review gate.

## Tasks

1. Complete ordinal-aware text/media ownership and direct predecessor-chain
   remediation.
2. Run targeted independent audits and focused local verification.
3. Validate docs, privacy, type safety, and full branch diff.
4. Commit and push the existing PR branch.
5. Run ReviewGPT round 7 and exact-head GitHub Actions; update PR evidence.

## Decisions

- Use a strict nullable predecessor-intent field on every marked member:
  `null` is the root and each successor names the immediately prior intent.
- Reject legacy marked rows without explicit linkage and field-bearing unmarked
  rows; this is a fingerprinted runtime hard cut, not a compatibility shim.
- Keep the final local-service file on focused verification because its full
  standalone run is a known memory failure in this checkout.

## Verification

- Commands: affected Vitest files, focused local-service tests, package
  typechecks, `pnpm docs:drift`, `git diff --check`, identifier scan, ReviewGPT
  round 7, and required GitHub Actions.
- Expected outcomes: all checks pass; no final provider call can bypass required
  predecessor evidence; no duplicate PR is opened.
- Local results: assistant Codex 245/245, outbox ordering 20/20, outbox runtime
  97/97, assistant service 66/66, hosted callbacks 216/216, operator contracts
  22/22, and focused local service 16/16 passed. All three affected package
  typechecks, docs drift, diff hygiene, privacy, and forbidden-cast checks
  passed. Targeted media, delivery, exact-chain, and rollout reviews passed
  after remediation.
Completed: 2026-07-30
