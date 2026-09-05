# Resolve daily nutrition context in one canonical read

Status: active
Created: 2026-09-04
Updated: 2026-09-04

## Goal and protected invariants

Reduce repeated model turns and goal documents for daily nutrition cards while preserving canonical goal authority, same-date fresh meal totals, explicit proposal acceptance, and narrow health suitability rules.

## Owner and evidence

The existing meal totals query and service own canonical nutrition reads. The response-card tool currently requires active-goal listing, one detail read per targeted goal, then a meal totals read. Target identity, windows, comparators, units, and legacy rules are model-resolved. Extend that existing query with optional single-date goal resolution; use one canonical goal-family scan, without new persistence, service, tool, dependencies, or mutations.

## Scope and failure

Resolve applicable targets into compact snapshots with provenance, explicit missing/conflict/incompatible states, and no raw incompatible values. Preserve the bounded active-goal capacity guard and all clinical/proposal/recovery authority. Query failures remain failures. Existing totals callers retain their exact result shape. No deployments or production mutations.

## Tasks

1. Implement and test canonical target resolution and opt-in meal totals plumbing.
2. Replace only superseded target-resolution instructions; keep health and proposal policy.
3. Run focused deterministic tests, typechecks, and production-derived synthetic live journeys for complete/legacy/conflicting/missing targets and exact action counts.
4. Inspect privacy, complexity, UX, and final diff; open scoped draft PR for parent review, then required CI and ReviewGPT.

## Verification

Query tests cover complete authority, dates, cap, competing owners, incompatible units/comparators/evaluation, legacy coherence, sparse totals, and no fabricated values. CLI/service tests prove opt-in shape and single-date validation. Real assistant journeys prove one canonical nutrition read, no N+1 goal reads or unauthorized writes, correct card or fallback, and concise truthful replies.

## Progress and review evidence

- Implemented one optional meal totals query path, with no new state or tool.
- Query regressions pass, including complete/partial/conflicting/legacy bundles,
  unit/evaluation/date/cap behavior, irrelevant legacy data, and real canonical
  write/read/status transitions. Query, service, CLI, and assistant typechecks
  have passed; final fixture edits are being rechecked.
- Parent source review requested irrelevant-target boundaries; both are covered.
- A live rolling legacy card had correct values but repeated the same read.
  Owning instructions now preserve a successful same-turn read across read-only
  checks while still requiring a new read after mutations.
- New live scenarios now use actual canonical state and production CLI execution,
  with exact command counts and Goal before/after equality.
- Existing aggregate CLI schema proof exceeded its 45-second budget twice;
  direct CLI option/rejection proof passed. Task-owned Frog records the gap.
- Complexity guard passes; new resolver maximum is 14, existing meal-add
  hotspots remain unchanged.
- Resumed candidate review reproduced and fixed malformed legacy-only Goal
  windows blocking valid canonical authority. Window validation now occurs
  only in the selected canonical or fallback legacy candidate pass.
- Corrected the live fixture's deterministic CLI assertion to the production
  direct JSON result shape. Real CLI fixture and opt-in/rejection proof pass;
  the full focused query suite now passes 28 tests, and assistant boundary
  suites pass 41 tests. Focused live evidence and final typechecks are running.
