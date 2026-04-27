# Alcohol-free and protein-floor Health Commons research

Status: active
Created: 2026-04-26
Updated: 2026-04-27

## Goal

- Start two separate Health Commons research workflows:
  - short-term alcohol-free challenge, including candidate 7-day, 14-day, and 30-day variants
  - protein-floor / high-protein intake target around 1.5-2.0 g/kg/day
- Success means each workspace has a coherent charter prompt, a persisted `01-charter` thread URL, and enough scope discipline to proceed to materialization after harvest.

## Success criteria

- `output-packages/research/short-term-alcohol-abstinence` exists and treats alcohol abstinence as a short-term behavior-change family plus duration variants, not alcohol-use-disorder treatment.
- `output-packages/research/protein-floor-high-protein-intake` exists and treats protein-floor eating as a dietary target family plus target/delivery variants, not a generic weight-loss diet or bodybuilding plan.
- Each `01-charter` is sent through a different named managed browser lane to share load.
- The charter prompts explicitly preserve adjacent exclusions and safety boundaries.
- No live Health Commons content, generated catalog output, source pages, protocol pages, or artifact manifests are landed in this start-up slice.

## Scope

- In scope:
  - `output-packages/research/short-term-alcohol-abstinence/**`
  - `output-packages/research/protein-floor-high-protein-intake/**`
  - this execution plan
  - the shared coordination-ledger row for this research lane
- Out of scope:
  - Landing live Health Commons family, protocol, source, biomarker, artifact, or generated catalog files.
  - Combining the two interventions into one protocol.
  - Medical detox, alcohol-use-disorder treatment, medication-assisted treatment, or clinician-managed withdrawal.
  - Clinical renal diet, disease-specific protein restriction, bodybuilding contest prep, or protein supplementation as a standalone intervention unless the charter justifies a separate variant.

## Constraints

- Preserve unrelated dirty work and active research harvests in the shared checkout.
- Use workspace-specific research config and named managed browser lanes.
- Share load across browser profiles; do not serialize both charters on one lane.
- Keep claims conservative and source-bound.
- Keep safety language visible, especially alcohol withdrawal risk and kidney disease or other contraindications for high protein intake.
- Do not expose local identifiers, secrets, or personal data in generated files, logs, commits, or handoff.

## Risks and mitigations

1. Risk: the alcohol-free workflow conflates light-to-moderate drinkers doing a voluntary abstinence challenge with people at withdrawal risk.
   Mitigation: require the charter to split medical detox/AUD treatment out of the direct protocol boundary and preserve withdrawal screening as a safety requirement.
2. Risk: the protein-floor workflow collapses protein target evidence with resistance training, weight-loss dieting, or supplement-only trials.
   Mitigation: require the charter to track target grams/kg/day, whole-food versus supplement delivery, resistance-training cointerventions, energy balance, and population separately.
3. Risk: multiple active research seams overload one browser lane.
   Mitigation: send the two charters on different lanes and continue later discovery/harvest work through a lane-aware queue.

## Tasks

1. Initialize the two research workspaces. Done.
2. Add charter scoping guardrails. Done.
3. Send each `01-charter` on a different managed lane. Done.
4. Record thread URLs and seam state. Done.
5. Harvest charters when ready and review boundaries before materialization. Done.
6. Send discovery shards across browser lanes. Done.
7. Harvest discovery shards through a lane-aware queue. Done.
8. Run snowball/gap-fill for both workspaces. Done.
9. Run source-ledger reducers and validate extraction batches. Done.
10. Run source extraction batches across browser lanes. Done.
11. Materialize section-synthesis prompts and wrappers. Done.
12. Harvest already-sent section-synthesis threads without starting new sends. Done.
13. Run page-builder seams. Running.
14. Run evidence QA and safety QA once after page-builder. Running.
15. Run final landing reducers after QA artifacts are harvested. Pending.

## Current state

- Workspace: `output-packages/research/short-term-alcohol-abstinence`
- Workspace: `output-packages/research/protein-floor-high-protein-intake`
- Planned initial lanes:
  - alcohol-free charter: `eragon`
  - protein-floor charter: `vonneumann`
- Charter thread URLs:
  - alcohol-free: `https://chatgpt.com/c/69edf5a3-69d0-83a0-96ec-eaec0ab44d3b`
  - protein-floor: `https://chatgpt.com/c/69edf5ce-e1ec-839b-95da-50f3bfa79f17`
- Workspaces initialized.
- Charter prompts now include operator guardrails for adjacent exclusions, duration or dose variants, outcome breadth, and safety boundaries.
- Charter sends completed on separate lanes.
- Charter harvests completed and both workspaces were materialized.
- Alcohol-free discovery sends are complete for 9 shards across `hercules`, `eragon`, and `mountain`.
- Protein-floor discovery sends are complete for 10 shards across `hercules`, `eragon`, `vonneumann`, and `mountain`.
- Alcohol-free discovery harvest is complete for 9/9 shards; protein-floor discovery harvest is complete for 10/10 shards.
- Snowball/gap-fill is complete for both workspaces.
- Alcohol-free `11-source-ledger-reducer` is harvested and valid: 281 canonical source records across 11 extraction batches, with no batch over 40 records.
- Protein-floor `11-source-ledger-reducer` is harvested and valid: 335 canonical source records across 17 extraction batches, with no batch over 40 records.
- Alcohol-free source extraction prompts and send/harvest wrappers are generated. Extraction batches 001 through 010, including split batch 008-1 and 008-2, are harvested successfully; batch 006 was retried only after the saved conversation URL was confirmed visible in the recorded `eragon` browser lane.
- Protein-floor source extraction prompts and send/harvest wrappers are generated. Batches 001-017 are harvested successfully.
- Section-synthesis prompts and command wrappers are materialized for 12 alcohol-free sections and 12 protein-floor sections.
- Section-synthesis sends were recorded for all sections from prior/background fanout and have now been harvested successfully.
- Alcohol-free section-synthesis state: 12/12 sections have succeeded. `30-page-builder` succeeded after normalizing returned descriptive filenames into the expected artifact-contract names. Evidence QA is actively harvesting on `phlebas`; safety QA is actively harvesting on `mountain`.
- Protein-floor section-synthesis state: 12/12 sections have succeeded. The first `30-page-builder` attempt failed with a ChatGPT "Thinking failed" response on `eragon`; the fresh retry has a saved `vonneumann` URL and is actively harvesting there.
- Current browser-ownership guard: do not harvest any saved conversation from a different managed browser profile unless the exact saved `/c/<conversation-id>` visibly loads in that profile and live CDP confirms that exact URL in the target profile.
- Coordination note: alcohol-free extraction batch 006 previously had a wrong-profile/unable-load concern. Before retry, the saved URL was checked against live CDP targets for the recorded `eragon` endpoint and matched the target conversation path; the harvest retry then completed on `eragon`.

## Verification

- Planned:
  - Direct readback of `workflow.json`, `prompts/01-charter.md`, `state/chat-urls/01-charter.txt`, and seam state after send.
  - `git diff --check -- agent-docs/exec-plans/active/2026-04-26-alcohol-free-protein-floor-research.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`

Results:
- `pnpm research:init "Short-term alcohol abstinence challenge, including 7-day, 14-day, and 30-day alcohol-free variants" --family alcohol-abstinence --slug short-term-alcohol-abstinence --out-dir output-packages/research/short-term-alcohol-abstinence` passed.
- `pnpm research:init "Protein floor high-protein intake target around 1.5 to 2.0 grams per kilogram per day" --family high-protein-intake --slug protein-floor-high-protein-intake --out-dir output-packages/research/protein-floor-high-protein-intake` passed.
- `pnpm research:run --workspace output-packages/research/short-term-alcohol-abstinence --seam 01-charter --action send --lane eragon` passed and recorded the thread URL.
- `pnpm research:run --workspace output-packages/research/protein-floor-high-protein-intake --seam 01-charter --action send --lane vonneumann` passed and recorded the thread URL.
- `pnpm research:run --workspace output-packages/research/short-term-alcohol-abstinence --seam 01-charter --action harvest` passed.
- `pnpm research:run --workspace output-packages/research/protein-floor-high-protein-intake --seam 01-charter --action harvest` passed.
- `pnpm research:materialize --workspace output-packages/research/short-term-alcohol-abstinence` passed and generated 9 discovery shards.
- `pnpm research:materialize --workspace output-packages/research/protein-floor-high-protein-intake` passed and generated 10 discovery shards.
- Discovery send state readback confirmed every generated discovery seam has `send.status=completed`.
- Discovery harvest artifact checks found no missing required artifacts for either workspace.
- Alcohol-free source-ledger reducer artifact check found no missing required artifacts, 281 canonical records, and extraction batch sizes of 14, 36, 28, 21, 12, 28, 35, 40, 6, 29, and 22.
- `bash -n` passed for generated alcohol-free source-extraction send and harvest wrappers.
- Protein-floor source-ledger reducer artifact check found no missing required artifacts, 335 canonical records, and extraction batch sizes of 11, 13, 18, 40, 8, 29, 35, 40, 27, 34, 21, 12, 10, 11, 9, 15, and 1.
- `bash -n` passed for generated protein-floor source-extraction send and harvest wrappers.
- Alcohol-free extraction batch 001 downloaded valid extraction artifacts with 28 source findings.
- Alcohol-free extraction batch 002 downloaded valid extraction artifacts with 40 source findings.
- Alcohol-free extraction batch 003 downloaded valid extraction artifacts with 28 source findings.
- Alcohol-free extraction batch 004 downloaded valid extraction artifacts with 21 source findings.
- Alcohol-free extraction batch 005 downloaded valid extraction artifacts with 28 source findings, 12 evidence appraisals, and 2 artifact candidates.
- Alcohol-free extraction batch 006 downloaded valid extraction artifacts with 30 source findings, 28 evidence appraisals, and 2 artifact candidates after verified `eragon` browser-lane harvest.
- Alcohol-free extraction batch 007 downloaded valid extraction artifacts with 35 source findings.
- Alcohol-free extraction batch 008-1 send completed on `mountain`.
- Alcohol-free extraction batch 008-2 send completed on `vonneumann`.
- Alcohol-free extraction batch 009 send completed on `eragon`.
- Alcohol-free extraction batch 010 send completed on `hercules`.
- Alcohol-free extraction batch 010 downloaded extraction artifacts and completed with status `succeeded`.
- Alcohol-free extraction batches 008-1, 008-2, and 009 also downloaded extraction artifacts and completed with status `succeeded`.
- Protein-floor extraction batch 001 downloaded valid extraction artifacts with 23 source findings, 11 evidence appraisals, and 2 artifact candidates.
- Protein-floor extraction batch 002 send completed on `mountain`.
- Protein-floor extraction batches 003-017 send fanout completed across `vonneumann`, `phlebas`, and `eragon`.
- Protein-floor extraction batch 010 conversation `69ee3ce2-6c4c-8398-aff1-235466e2afc9` is on `phlebas` / `http://127.0.0.1:9442`, not `eragon`. Live CDP readback on 2026-04-27 showed that URL visible in `phlebas` and absent from `eragon`; do not harvest this conversation from `eragon`.
- Protein-floor extraction batch 005 downloaded extraction artifacts and completed with status `succeeded`.
- Protein-floor extraction batch 002 downloaded extraction artifacts and completed with status `succeeded`.
- Protein-floor extraction batches 008, 009, 011, 012, 014, 015, and 017 downloaded extraction artifacts and completed with status `succeeded`.
- Protein-floor extraction batches 003, 004, 006, 010, 013, and 016 downloaded extraction artifacts and completed with status `succeeded`.
- Protein-floor extraction batch 007 also downloaded extraction artifacts and completed with status `succeeded` on `phlebas` after restarting a stale running state with no live process.
- Protein-floor extraction batch state readback confirmed batches 001-017 all have persisted `state/chat-urls/12-source-extraction-batch-*.txt` files.
- Direct extraction status readback found all 11 alcohol-free extraction statuses and all 17 protein-floor extraction statuses are `succeeded`, with 69 and 107 downloaded artifact records respectively.
- Live CDP readback confirmed protein-floor batches 002-017 were visible in their recorded browser profiles after fanout; batch 001 is already harvested and no longer needs a live tab.
- Managed browser tab count readback after fanout remained under the soft 20 open ChatGPT tabs/profile limit: `phlebas` 13, `vonneumann` 8, `hercules` 16, `eragon` 13, `mountain` 18.
- `pnpm research:materialize` plus the section-synthesis materializer produced section prompts and send/harvest wrappers for both workspaces.
- `bash -n` passed for all generated section-synthesis send/harvest wrappers.
- Section-synthesis readback found all 12 alcohol-free and all 12 protein-floor section-synthesis seams succeeded. Page-builder harvests are now active for both workspaces.
- Alcohol-free `30-page-builder` artifacts were normalized locally after a successful download because returned filenames were descriptive rather than contract names: `short-term-alcohol-abstinence-protocol.md` was copied to `short-term-alcohol-abstinence.md`, and `alcohol-abstinence-family.md` was copied to `alcohol-abstinence.md`. The seam state was updated to completed after the required artifact-contract names existed.
- Alcohol-free QA sends completed: `31-evidence-qa` on `phlebas` and `32-safety-qa` on `mountain`; both harvests are active on their recorded lanes.
- Protein-floor `30-page-builder` retry was sent on `vonneumann` and is actively harvesting on its recorded lane.
