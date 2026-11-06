# Ground lodging destinations in source evidence

Status: completed
Created: 2026-09-25
Updated: 2026-09-25

## Outcome

Keep confirmed lodging plans useful without interpreting property names or scenic
amenities as geographic evidence. Preserve dates, source identity, member
corrections, silent capture, and conditional use of genuine itineraries.

## Owner and evidence

The Journal connected-context skill owns source interpretation and canonical
plan writes. The connected-apps skill owns later reminder location resolution.
Inspection established that a property label can be saved as a destination and
reverified without supporting geographic detail. Private evidence remains out
of repository artifacts. Existing canonical event edits and projections suffice;
no schema, new state, parser, geocoder, or scheduler is needed.

## Product UX

Outcome: derive booking destinations from explicit source geography.
Reaches: automatic travel capture and later private outdoor reminders.
Proof: synthetic confirmations with a misleading property name, explicit versus
missing destination details, neutral unknown-location capture, correction of an
existing imported event in place, unchanged canonical memory, and silent output.

## Tasks

1. Done: prove the missing instruction boundary deterministically.
2. Done: clarify source interpretation and exact-source correction in existing skills.
3. Done: add focused real-model journeys using real canonical writes and readback.
4. Done: run focused tests and typecheck; review effects, privacy, and prose.
5. Commit the local implementation candidate.

## Verification

- Regression first: the new lodging-source instruction test failed on the prior
  prompt and passed after the correction.
- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts
  test/connected-apps-prompt.test.ts --no-coverage`: 10 passed.
- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts
  test/assistant-skill-assets.test.ts --no-coverage`: 26 passed, 7 opt-in skips.
- `pnpm --dir packages/assistant-engine typecheck`: passed.
- `pnpm complexity:diff`: passed; only test TypeScript changed, no authored
  production TypeScript complexity change.
- `git diff --check` and authored-diff privacy inspection: passed.
- Focused real-model proof passed with `gpt-6-sol` through local subscription
  authentication. Each scenario ran through `pnpm test:assistant:live -- --test
  'grounds lodging geography in the full confirmation: <scenario>'` and the
  existing `--codex-home` selector for an authenticated local profile:
  - `explicit destination`: one exact confirmation read, one canonical plan,
    correct source-backed city, no misleading property/footer geography.
  - `unknown destination`: one exact confirmation read, one neutral plan with
    unknown destination, source-backed dates/timezone, no inferred city.
  - `repair imported destination`: one exact confirmation read, one revision-
    checked edit to the original event, corrected city/timezone, no duplicate.
  All final decisions were silent; no follow-up or memory write occurred.
  Product UX verdict: Ready for the tested scenarios and model.
- Initial subscription attempts failed before tool execution; one available
  profile completed the journeys. Early proof assertions were corrected to
  accept equivalent uncertainty wording and compare canonical memory records
  rather than timestamps synthesized for an absent memory document.

## Completion boundary

Prompt-primary correction with no schema, permissions, or external-effect changes:
parent review applies; final ReviewGPT is not required. Implementation, real-model
proof, production deployment, and correction of an existing member record remain
separate evidence claims. No PR or deployment has been requested or performed.
A public-safe release note is required with a future shipping PR; no release is
claimed by this local candidate.
Completed: 2026-09-25
