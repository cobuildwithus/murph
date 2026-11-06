# Reserve the existing child cleanup budget for optional correction

Status: completed
Created: 2026-09-21
Updated: 2026-09-21

## Outcome and review disposition

Resolve the remaining accepted original-PR timeout finding on PR #3638. The
round-two guard reserved five seconds, but the existing child owner can wait
15 seconds after interruption and perform two stop attempts, each with two
three-second waits. Preserve successful extraction while joining the exact child
before the shared page deadline; keep cancellation and authority fences.

## Requirement check

The prior correction used a guessed cleanup allowance at the right admission
owner. Replace the guess with existing owner constants, retaining the same
optional correction and deadline. No new state, timer, retry, queue or lifecycle
is needed. Source dates and member interaction remain unchanged.

## Product UX

Effort: Patch. Journeys: late successful extraction with stalled correction,
early successful extraction with interrupted-child cleanup, explicit cancellation
and provider handoff. Verdict: Ready.

## Tasks and verification

1. Reproduce delayed child cleanup in the composed runtime/engine test.
2. Derive admission allowance from current child lifecycle constants.
3. Run focused regression and child-owner proof, typechecks, live journey,
   parent review, and round-three review alongside CI on the pushed head.

## Results

- True red-to-green composed regression: after 78 seconds of initial extraction,
  stalled correction previously joined at 135 seconds with zero proposal writes.
  It now skips optional work and persists at 78 seconds. With 50 seconds of
  extraction, correction can time out, join all 27 seconds of child cleanup and
  persist at 107 seconds. Explicit cancellation and authority handoff persist
  nothing. Six composed cases pass; 40 focused runtime tests pass.
- All 64 focused engine tests pass, including 42 existing child lifecycle
  recovery cases and 22 extraction cases. Combined task proof is 214 tests with
  unchanged clinical, canonical and changelog checks from the preceding head.
- Both affected package typechecks pass. The other two package typechecks from
  the preceding head remain applicable to unchanged packages.
- The same live production recovery journey passes with gpt-5.6-terra, local
  subscription, one real correction call and 7,216 tokens. Calendar-only dates
  remain exact, valid siblings remain unchanged, source bytes remain unchanged
  and no canonical writes occur. Verdict: Ready.
- Complexity guard passes: the two timeout constants keep their existing
  values. The shared import touches the existing Codex owner without changing
  any function or its 11 pre-existing complexity hotspots. No new lifecycle or
  process cleanup behavior is introduced.
- Parent diff and privacy review passed. Round-three review and required CI
  remain completion gates on the pushed remediation head.
Completed: 2026-09-21
