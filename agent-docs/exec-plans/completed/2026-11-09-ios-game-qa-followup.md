# Additional game edge-case QA

Status: completed
Created: 2026-11-09
Updated: 2026-11-09

## Outcome

Run two additional synthetic edge-case passes, reproduce and fix confirmed bugs,
then open the native fix PR and linked backend QA evidence PR. Preserve the
completed first-round plan as historical evidence. No production mutations or
member messages. If a fix changes visible UI, show before/after in Paper.

## Passes

1. Interrupted and overlapping operations: lost acknowledgements, retries,
   offline recovery, first Home failure, replies and local state restoration.
2. Terminal and calendar boundaries: settlement, tickets, rematch, account or
   safety changes, and native rendering of boundary states.

Each pass combines focused executable journeys, source tracing and screenshot
inspection. New fixes require a failing regression followed by green proof.
Record untested hardware and transport boundaries without claiming exhaustion.

## Completion

Update the state map; run relevant builds, tests, lint and typechecks; finish
parent review and the already-selected native independent local review gate.
Push scoped branches, open linked PRs and check their required hosted status.

## Results

- Reproduced and fixed three additional defects: Home-confirmed posts remaining
  pending after lost acknowledgements, old reads undoing newer access denial,
  and Return dropping the last coalesced reply character.
- Pass 4 UI: 14/15 initially passed, with the remaining failure proving reply
  text loss. Pass 5 UI: all 58 passed after the fix. Pro Max Return also passed.
- Canonical calendar/terminal/backend proof: 132 tests passed.
- Native regression proof: 136 tests plus the additional retake race passed.
- Native builds, generation and source lint passed. Independent local review
  found no additional concrete defect. Backend changes in this follow-up are
  documentation only; its earlier test/code typechecks remain applicable.
- Actual simulator before/after comparison created and inspected in Paper.
- See the updated state map for scope, prior real-model proof and limitations.
Completed: 2026-11-09
