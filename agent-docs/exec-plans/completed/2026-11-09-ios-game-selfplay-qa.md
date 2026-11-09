# Synthetic iOS game self-play QA

Status: completed
Created: 2026-11-09
Updated: 2026-11-09

## Outcome and invariants

Synthetic players can finish supported game journeys, edit permitted terms through
real GPT-6.1 Sol in mocked iMessage conversations, and recover from refused or
uncertain actions without incorrect scores, duplicate writes or trapped screens.
The backend remains the authority for terms, scoring, audience and settlement.
No real member data, messaging deliveries or production mutations are involved.

## Scope and proof

- Native baseline: iOS main `40acb0d2`; backend baseline: `ed361af347`.
- Map reachable product states, transitions, exits and verification gaps.
- Exercise pair setup, invitation, negotiation, daily artifacts and corrections,
  proposals, settlement, recap, tickets, rematch and recovery.
- Audit staged group behavior against the current native capability boundary.
- Use production prompt builders and game tools with local subscription model
  calls; synthetic ports prove their layer, not actual iMessage delivery.
- Fix only reproduced defects at their existing owner, add regression proof,
  and rerun affected journeys. Preserve unrelated work in dedicated checkouts.
- Two successive exploration rounds with no new confirmed defects close the
  covered matrix; this is not a claim of exhaustive combinatorial correctness.

## Tasks

1. Inventory native and server states and existing QA facilities.
2. Run native simulated gameplay and deterministic game boundary proof.
3. Run focused real-model chat edit journeys; inspect actions and replies.
4. Add composed synthetic journeys where existing disconnected fixtures leave a gap.
5. Reproduce, fix and verify confirmed defects, then explore remaining exits.
6. Review changes, record coverage and residual gaps, and commit scoped results.

## Decisions

- Fix-and-retest authorized explicitly by the user.
- Existing detached primary iOS checkout predates games; use a fresh current-main checkout.
- Use one simulator worker under the shared heavy-job limiter.
- Current native main is pair-oriented; do not claim group UI coverage from backend tests.

## Evidence ledger

See [the state map](../../references/game-selfplay-qa.md) for exact layer boundaries,
journeys and limitations, and its linked machine-readable native scenario inventory.

- 175 declared scenarios and 174 screen variants inventoried; 63 screenshot-sweep
  variants exercised. Computer use completed setup, editing and backtracking.
- Four native stale-state defects reproduced and fixed, with adversarial
  response-order regression tests; 142 final adjacent native tests passed.
- Canonical real GPT-6.1 Sol self-play used both seats and four exactly-once
  mutations; seven two-seat Home snapshots passed native decode/projection proof.
- Three additional focused real-model journeys passed. Canonical focused rules
  (60), deterministic assistant boundaries (59), and group rules (166) passed.
- Recovery exploration (23 UI tests) and artifact/reply exploration (57 UI tests)
  passed with no new confirmed product defects; screenshots inspected.
- Three initial UI harness failures were diagnosed and corrected, with targeted
  green proof. All 62 changed-class tests passed on Pro Max, with both changed
  setup interactions also passing on SE.
- Both native schemes built, source lint and both backend typechecks passed.
- Independent native deep review returned no remaining concrete finding;
  parent candidate review completed. No production source changed in the backend.

## Remaining limitations

- Current native gameplay is pair-oriented; group server proof is not native UI proof.
- Camera, HealthKit, GPS and Bluetooth simulations exclude physical hardware.
- Mocked transport and live model tool relays exclude actual iMessage delivery
  and production runtime restarts. Release-wide CI has not run on this branch.
- No claim of universal bug absence. Two final exploratory rounds were clean
  within the documented matrix; unexecuted scenarios remain explicitly inventoried.
Completed: 2026-11-09
