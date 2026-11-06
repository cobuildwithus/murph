# Suppress repeated proactive health insights

Status: completed
Created: 2026-09-20
Updated: 2026-09-20

## Outcome and invariant

Members should not receive a standalone Personal Patterns update for a finding
already covered by another health note. Distinct new findings and materially
useful weekly reinterpretations remain eligible under existing evidence and
pacing rules. No new delivery, storage, schedule, or authority owner is needed.

## Evidence and owner

The managed daily recipe currently equates absence from its notification ledger
with novelty. It does not read the existing weekly insight page or apply the
shared proactive pacing policy. The weekly recipe reads both pages but does not
explicitly distinguish repetition from a useful new interpretation.

The smallest correction belongs in the managed recipes. Existing canonical
Knowledge pages and bounded conversation context provide the evidence; current
notification ledger writes retain reviewed identities across later daily runs.
No schema migration, runtime history store, provider call, or database change.
Separate incomplete runtime recovery evidence does not justify speculative
checkpoint changes in this patch.

## Product UX

Outcome: suppress repeated findings without announcing the suppression.
Reaches: daily first digest and later updates, with or without recent transcript
context; weekly notes preserve genuinely changed interpretation.
Proof: production-derived recipe assertions, managed reconciliation, and focused
real-model journeys for a previously covered finding and an unrelated prior note.

## Tasks

1. Correct daily novelty selection and weekly repetition guidance.
2. Prove deterministic composition and unchanged managed schedule/route ownership.
3. Run synthetic live journeys and inspect silence, writes, and genuine novelty.
4. Update the durable contract, run typecheck and complexity review, and commit.

## Verification

- Passed: 89 tests across `managed-automations.test.ts` and
  `assistant-personal-patterns-eligibility.test.ts`.
- Passed: assistant-engine and hosted Web typechecks.
- Passed: 10 production changelog archive rendering tests, run from repository
  root after generating the normal changelog module.
- Passed: three focused real-Codex journeys on `gpt-5.6-luna`, high reasoning,
  local subscription. Each selector ran separately through
  `pnpm test:assistant:live -- --test <selector> --model gpt-5.6-luna`:
  `cross-automation history.*covered.*false`,
  `cross-automation history.*covered.*true`, and
  `cross-automation history.*unrelated`.
- Both covered cases returned skip, wrote exactly one reviewed ledger, and kept
  firstSharedDate null. The unrelated case returned one new finding.
- UX verdict: Ready for these synthetic scheduled decisions. Production model
  behavior remains stochastic; this is not a transport-level dedupe guarantee.
- Passed: complexity diff and whitespace/privacy review. Existing reconciliation
  hotspots are unchanged; new behavior is entirely in managed instructions.
- Initial live attempts failed authentication before provider action. The
  standing alternate-session workflow found a working local subscription;
  all behavioral proof used that same session. No credentials were copied.
- Reused existing Frog reports for the documented changelog command's incorrect
  working directory and missing generated module. No new friction entry needed.
- Final review: existing schedules, routes, mute preferences, provider transport,
  and ledger schema remain owned by their current implementations. The change
  adds one bounded named Knowledge read to scheduled Personal Patterns runs.
  No foreground read or new notification owner is introduced.
- Final ReviewGPT is not required for this prompt-primary correction under the
  completion workflow. No runtime ordering or persistence implementation changed.
- Production deployment, exact-head CI if a PR is opened, and natural-traffic
  confirmation remain separate gates. No production mutation was performed.
Completed: 2026-09-20
