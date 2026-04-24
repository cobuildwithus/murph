# Set up a scoped Health Commons research workspace for Tabata 20/10 interval training without widening into evidence landing

Status: completed
Created: 2026-04-24
Updated: 2026-04-24

## Goal

- Set up a Murph Health Commons research workspace for Tabata-style 20/10 interval training and launch the initial charter on the `eragon` research lane.

## Success criteria

- A dedicated workspace exists under `output-packages/research/tabata-20-10-interval-training`.
- The workspace is provisionally scoped as `tabata-20-10-interval-training` under a broader `tabata-interval-training` family.
- The charter prompt explicitly separates the original Tabata-style 20-seconds-on/10-seconds-off interval protocol from generic HIIT, Norwegian 4x4, sprint interval training, circuit classes marketed as Tabata, resistance-training circuits, EMOM/AMRAP/metcon formats, and rehab/clinical exercise programs unless later evidence supports a merge.
- The charter prompt biases the research toward experiment-relevant outcomes, practical implementation boundaries, and safety constraints for high-intensity exercise.
- The initial charter seam is sent through the `eragon` lane, with thread state persisted by the research workspace.

## Scope

- In scope:
  - The workspace under `output-packages/research/tabata-20-10-interval-training`
  - This active plan and the coordination-ledger row needed to reserve the lane
  - Charter-prompt tailoring for Tabata boundaries, outcomes, and safety questions
- Out of scope:
  - Running the full evidence workflow
  - Landing Health Commons family, protocol, source, or artifact pages
  - Regenerating Health Commons catalogs
  - Changing research tooling or review-gpt profile defaults

## Constraints

- Preserve unrelated dirty-tree work.
- Keep the workspace repo-local and avoid hardcoded absolute paths.
- Do not fabricate charter responses, discovery outputs, or source claims during setup.
- Treat the 20/10 Tabata-style interval format as the starter protocol unless the charter later proves a better split.

## Risks and mitigations

1. Risk: "Tabata" is commonly used as a marketing label for generic HIIT or circuit training.
   Mitigation: Use a family-plus-starter-variant split and make adjacent exclusions explicit in the charter prompt.
2. Risk: High-intensity exercise evidence can mix athletic, clinical, and general-population contexts.
   Mitigation: Bias the charter toward directness labels, practical self-experiment feasibility, and stronger safety framing than efficacy claims.

## Tasks

1. [x] Register the task in the coordination ledger.
2. [x] Scaffold the Tabata workspace with the repo research initializer.
3. [x] Tailor the charter prompt for Tabata-family boundaries, outcomes, and safety questions.
4. [x] Send the `01-charter` seam on the `eragon` lane.
5. [x] Recover and materialize the charter response.
6. [x] Verify the generated workspace state and record any blockers.

## Outcome

- Workspace: `output-packages/research/tabata-20-10-interval-training`
- Charter thread: `https://chatgpt.com/c/69eafb0b-4b70-8398-b4f2-fd0ffb1e766a`
- Charter response: `output-packages/research/tabata-20-10-interval-training/responses/01-charter.md`
- The charter selected `split_variants`: keep the original supramaximal cycle-ergometer protocol separate from the practical Murph starter variant, and keep generic HIIT, Norwegian 4x4, Wingate/SIT, EMOM/AMRAP/metcon, resistance circuits, interval walking, and rehab/clinical exercise out of the direct protocol.
- The harvest wrapper kept classifying a completed inline thread export as busy even though `thread.json` showed `statusBusy: false`; the response was recovered from the latest assistant snapshot, normalized into the required fenced machine-readable block format, and materialized successfully.
- Post-charter discovery prompts and send/harvest wrappers were generated.

## Verification

- Commands to run:
  - `git diff --check`
  - direct readback of the workspace README, workflow metadata, and charter prompt
  - direct readback of persisted charter thread state after send
- Expected outcomes:
  - The generated research workspace stays path-relative and ASCII-safe.
  - The charter thread state is present under the workspace state directory after sending.

- Results:
  - `node -e` JSON parse check for both materialized workflows and charter seam-state files passed.
  - `bash -n` over both research workspaces' generated shell commands/config/scripts passed.
  - Required machine-readable charter heading readback passed for both charter responses.
  - `git diff --check -- agent-docs/exec-plans/active/COORDINATION_LEDGER.md` passed.
  - `pnpm test:smoke` passed.
  - `pnpm typecheck` passed.

Completed: 2026-04-24
