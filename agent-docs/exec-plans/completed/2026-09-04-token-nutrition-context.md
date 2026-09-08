# Resolve daily nutrition context in one canonical read

Status: completed
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
- Native provider-input capture verifies individual first input shrinking from
  166,647 to 164,354 UTF-8 bytes, with group unchanged at 128,210. The target
  tokenizer is unavailable; o200k_harmony counts are diagnostic only.
- A live source-CLI run lost yielded execution session metadata and repeated
  reads. Existing Frog issue 2492 covers this fixture transport problem. The
  local fixture now preserves complete command results and waits for the same
  session. The rolling-legacy live journey passes with exactly one nutrition
  read, zero Goal commands or mutations, and one correct card.
- The date-window live journey also passes. Action evidence now expands native
  batched CLI calls before counting reads, using the existing command parser;
  its regression and the final assistant typecheck pass.
- The remaining live fixtures explicitly preserve native exec session metadata.
  This is local synthetic transport guidance, with no business-policy hints.
- The intermediate commit hook is queued behind unrelated shared-host verification.
  Its schema regeneration is documented as advisory with CI fallback. Independent
  source schema and generated skill-hash parity checks are running before any
  cancellation of this session's queued regeneration only.
- Conflicting-target live journey passes with one canonical read, truthful text,
  no card, and no Goal mutations. Two remaining fallback journeys are running.
- Independent source schema and generated skill-hash parity pass (11 tests).
  The proven-owned queued advisory regeneration was cancelled through its
  supported signal handler; the hook continued with required CI verification.
- Draft PR 2878 contains the intermediate implementation. Final fixture proof
  and the scoped content-only nutrition changelog entry precede readiness.
- All five isolated real assistant journeys pass: rolling historical targets,
  selected-date window, conflicting targets, incompatible unit, and activity-only
  calorie authority. Every case proves exactly one canonical nutrition read,
  zero Goal commands or mutations, no progress chatter, and the correct card
  or truthful fallback. Batch normalization preserves exact command accounting.
- The content-only changelog production archive test passes all nine tests;
  final public diff privacy and whitespace checks pass. Web typecheck is running.
- Parent reviewed and approved the final fixture protocol/batch evidence,
  wording correction, and factual changelog. No behavior edits remain planned;
  stable-head CI and required ReviewGPT follow final local Web typecheck.
- Web typecheck passes. All local focused gates and parent candidate review
  are complete; the intended candidate is being pushed for concurrent CI and
  required final ReviewGPT. The plan remains active until those gates resolve.
- ReviewGPT round 1 PASS at 4ebb3cd1c705f18031aaab6c55a57eff4557cf9d
  on Eragon with gpt-6-pro. Exact model, committed user/assistant turns,
  response SHA-256, attachment, head, and completion marker were verified.
  Send-to-capture was 439.976 seconds. Parent accepted this near-threshold
  review because it substantiated all 22 postimages and canonical/legacy,
  date/conflict/capacity, suitability, and refresh boundaries proportionately.
  The review claimed source/contract inspection, not independent test execution.
- An adjacent characterization check exposed two stale route-plan hashes.
  Ignored full baseline/head captures proved only the reviewed response-card
  description and its derived contract fingerprint changed for direct and
  scheduled-email routes; the other three routes remain byte-identical.
  Parent approved refreshing only those two test expectations under the
  isolated-proof exception. The system-prompt size ratchet passed unchanged.
- Exact-head CI has passed fixture integrity, release build/typecheck, macOS
  CLI, sandbox, billing, cardinality, private-artifact, overflow, and PR evidence
  checks at the reviewed head. Final-head CI remains a publication gate after
  the isolated proof refresh and plan closure; no merge or deploy is authorized.
- Both targeted characterization/size checks pass after the two expectation
  refreshes, and assistant-engine typecheck passes again. Parent final approval
  covers the isolated proof update; implementation and local validation are done.
Completed: 2026-09-04
