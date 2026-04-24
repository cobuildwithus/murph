# Set up a scoped Health Commons research workspace for IT-band rehab and return-to-run without widening into treatment claims

Status: completed
Created: 2026-04-24
Updated: 2026-04-24

## Goal

- Set up a Murph Health Commons research workspace for iliotibial-band-syndrome rehab, prehab, and return-to-run/cycling protocols without landing treatment recommendations or Health Commons pages.

## Success criteria

- A dedicated workspace exists under `output-packages/research/it-band-syndrome-rehab-and-return-to-run`.
- The workspace is provisionally scoped as `it-band-syndrome-rehab-and-return-to-run` under a broader `iliotibial-band-syndrome-rehabilitation` family.
- The charter prompt separates conservative ITBS rehab and load management from diagnosis, acute traumatic knee injuries, injections/surgery, generic runner's knee, patellofemoral pain, meniscal/LCL/stress-fracture differentials, and generic mobility programs unless later evidence supports a merge.
- The charter prompt biases the research toward practical self-experiment boundaries, conservative safety language, red-flag exclusions, and measurable outcomes such as pain, function, recurrence, return-to-run/cycling tolerance, strength, and adherence.
- The initial charter seam is ready to send through a managed research lane once it can run without colliding with the active Tabata charter harvest.

## Scope

- In scope:
  - The workspace under `output-packages/research/it-band-syndrome-rehab-and-return-to-run`
  - This active plan and the coordination-ledger row needed to reserve the lane
  - Charter-prompt tailoring for ITBS rehab boundaries, safety exclusions, and outcome framing
- Out of scope:
  - Medical diagnosis or individualized treatment advice
  - Running the full evidence workflow
  - Landing Health Commons family, protocol, source, or artifact pages
  - Regenerating Health Commons catalogs
  - Changing research tooling or review-gpt profile defaults

## Constraints

- Preserve unrelated dirty-tree work.
- Keep the workspace repo-local and avoid hardcoded absolute paths.
- Do not fabricate charter responses, discovery outputs, source claims, or clinical recommendations during setup.
- Treat this as a research charter for conservative protocol boundaries, not a care plan for any individual.

## Risks and mitigations

1. Risk: IT-band symptoms can overlap with other knee or hip conditions.
   Mitigation: Make differential-diagnosis exclusions and referral/red-flag boundaries explicit in the charter prompt.
2. Risk: Rehab evidence may overstate certainty around hip strength, stretching, gait retraining, foam rolling, or manual therapy.
   Mitigation: Require directness labels by intervention component, population, supervision level, and outcome, and preserve mixed or null findings.

## Tasks

1. [x] Register the task in the coordination ledger.
2. [x] Scaffold the IT-band rehab workspace with the repo research initializer.
3. [x] Tailor the charter prompt for ITBS rehab scope, exclusions, outcomes, and safety.
4. [x] Send the `01-charter` seam on a managed research lane when safe.
5. [x] Recover and materialize the charter response.
6. [x] Verify the generated workspace state and record any blockers.

## Outcome

- Workspace: `output-packages/research/it-band-syndrome-rehab-and-return-to-run`
- Charter thread: `https://chatgpt.com/c/69eafc42-15cc-839e-8e15-75fa75a3c1e0`
- Charter response: `output-packages/research/it-band-syndrome-rehab-and-return-to-run/responses/01-charter.md`
- The charter normalized the display title to `Iliotibial Band Syndrome Rehab And Return To Run`, preserved the `it-band-syndrome-rehab-and-return-to-run` slug, and scoped the family as `iliotibial-band-syndrome-rehabilitation`.
- The charter kept diagnosis, traumatic injuries, meniscal/LCL/stress-fracture differentials, patellofemoral pain, passive-only treatments, injections, surgery, and complex supervised clinical rehab out of the direct protocol unless later extraction proves direct inclusion.
- The `hercules` lane completed the send and harvest successfully, and post-charter discovery prompts plus send/harvest wrappers were generated.

## Verification

- Commands to run:
  - `git diff --check`
  - direct readback of the workspace README, workflow metadata, and charter prompt
  - direct readback of persisted charter thread state after send, if sent this turn
- Expected outcomes:
  - The generated research workspace stays path-relative and ASCII-safe.
  - No diagnosis or treatment claims are landed in repo content.

- Results:
  - `node -e` JSON parse check for both materialized workflows and charter seam-state files passed.
  - `bash -n` over both research workspaces' generated shell commands/config/scripts passed.
  - Required machine-readable charter heading readback passed for both charter responses.
  - `git diff --check -- agent-docs/exec-plans/active/COORDINATION_LEDGER.md` passed.
  - `pnpm test:smoke` passed.
  - `pnpm typecheck` passed.

Completed: 2026-04-24
