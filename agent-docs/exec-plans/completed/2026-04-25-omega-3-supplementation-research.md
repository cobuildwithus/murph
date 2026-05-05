# Omega-3 supplementation Health Commons research

Status: completed
Created: 2026-04-25
Updated: 2026-05-06

## Goal

- Run a Health Commons research workflow for omega-3 supplementation in parallel with the active supplement/research lanes.
- Start with a charter that scopes an EPA/DHA supplementation family and one starter protocol variant without collapsing adjacent omega-3 modalities.
- Land the completed final reducer package for the bounded starter protocol after local validation.

## Success criteria

- A dedicated `output-packages/research/omega-3-supplementation` workspace exists.
- The charter prompt includes explicit modality boundaries and exclusions.
- The `01-charter` seam is sent through a named review-gpt lane and its thread URL is persisted.
- The final reducer artifacts are downloaded, the unified diff applies cleanly, and the Health Commons generation/check/dry-run commands pass or any unrelated blocker is recorded.

## Scope

- In scope:
  - `output-packages/research/omega-3-supplementation/**`
  - Final Health Commons content pages returned by the completed reducer for the bounded starter protocol.
  - this execution plan
  - the shared coordination ledger row for this research lane
- Out of scope:
  - Editing Health Commons content outside the reducer-returned package.
  - Committing regenerated `packages/health-commons/generated/**` artifacts unless explicitly required by the verification lane.
  - Collapsing diet-only fish/ALA, krill oil, prescription lipid therapy, prenatal DHA, or clinical-supervision contexts into the OTC EPA/DHA starter protocol.

## Constraints

- Preserve unrelated dirty work and active research harvests.
- Use a named managed review-gpt browser lane.
- Keep EPA/DHA supplements, ALA foods/oils, krill oil, prescription icosapent ethyl/high-dose lipid therapy, prenatal/infant DHA, and clinical supervised indications separate unless the charter justifies a merge.
- Treat omega-3 as high safety/caution for anticoagulants, bleeding disorders, surgery, fish/shellfish allergy, atrial fibrillation signal review, and high-dose lipid-management contexts.

## Risks and mitigations

1. Risk: Overloaded omega-3 evidence collapses dietary fish intake, OTC EPA/DHA supplements, prescription products, and clinical lipid therapy.
   Mitigation: Put explicit separation language into the charter before send.
2. Risk: Browser lanes are busy with existing research harvests.
   Mitigation: Pick the least-loaded available lane and let the workspace wake loop handle the long wait.

## Tasks

1. Initialize the omega-3 research workspace. Done.
2. Add charter scoping guardrails. Done.
3. Send `01-charter`. Done.
4. Start `01-charter` harvest. Done.
5. Record thread URL and current polling state. Done.
6. Run discovery fanout and harvest source-candidate artifacts. Done.
7. Complete source-ledger, extraction, section synthesis, page builder, evidence QA, safety QA, and final landing reducer. Done.
8. Apply the final reducer diff and run Health Commons verification. Done.

## Current state

- Workspace: `output-packages/research/omega-3-supplementation`
- Charter thread: `https://chatgpt.com/c/69ec3448-f0c8-839f-8a34-27ac7cda6bb3`
- Send lane: `hercules`
- Charter harvest: completed; recovered inline charter text with no attachments.
- Resolved identity: family `omega-3-supplementation`, starter protocol `oral-epa-dha-supplementation`.
- Post-charter seams: materialized.
- First discovery seam: `02-discovery-direct-adult-epa-dha`
- First discovery thread: `https://chatgpt.com/c/69ec3a64-0cec-83a0-902c-43f588f9617e`
- Completed discovery artifacts:
  - `02-discovery-direct-adult-epa-dha`: 53 candidate records.
  - `03-discovery-lipids-triglycerides-dose-response`: 40 candidate records.
  - `04-discovery-cardiovascular-outcomes-boundary`: 40 candidate records.
  - `07-discovery-mood-cognition`: 67 candidate records.
  - `11-discovery-variant-boundaries-external-context`: 40 candidate records.
- Remaining discovery sends: `03` through `11` completed on staggered managed lanes.
- Discovery, source-ledger, extraction batches, section synthesis, page builder, evidence QA, safety QA, and final landing reducer are complete.
- Final reducer artifacts: `output-packages/research/omega-3-supplementation/downloads/34-final-landing-reducer/downloads/`
- Final diff: `output-packages/research/omega-3-supplementation/downloads/34-final-landing-reducer/downloads/oral-epa-dha-final-unified.diff`
- Final reducer summary: 387 added content files, including 380 omega-3 source pages, 4 biomarker pages, one artifact manifest, one family page, and one oral-EPA/DHA-supplementation protocol page. No PDFs committed.
- Current repo step: bounded content package is applied and verified; close/commit the active plan only when the shared dirty ledger scope is safe.

## Verification

- `git diff --check -- <touched files>`
- Confirm `state/chat-urls/01-charter.txt` exists after send.
- Confirm the harvest process starts or record the error.

Results:
- `state/chat-urls/01-charter.txt` exists and records the charter thread URL.
- First harvest wake check started successfully on the recorded `hercules` lane.
- `git diff --check -- <touched files>` passed.
- `pnpm typecheck` failed in the existing generated Health Commons artifact path while `apps/web` ran `health-commons:generate`; the failure was `scripts/run-with-workspace-artifact-lock.mjs` setting `process.exitCode` to a Promise. This is in the active generated-artifact lane, not this omega-3 research setup.
- Charter harvest completed and `pnpm research:materialize --workspace output-packages/research/omega-3-supplementation` succeeded.
- All research phases through final landing reducer completed.
- `git apply --check output-packages/research/omega-3-supplementation/downloads/34-final-landing-reducer/downloads/oral-epa-dha-final-unified.diff` passed before applying.
- Privacy scan of the final diff did not find local path/account, redaction placeholder, bearer-token, or authorization-header strings.
- Final reducer diff was applied to Health Commons content with no PDFs committed.
- Added source-protocol evidence appraisal edges for all landed omega-3 research-landscape source references so the generator can validate the protocol evidence graph.
- Added minimal do-not-use stubs for the two excluded omega-3 source artifacts referenced by artifact provenance, preserving provenance without promoting retracted/excluded material into claims.
- `pnpm --filter @murphai/health-commons generate` passed.
- `pnpm --filter @murphai/health-commons generate:check` passed.
- `pnpm --filter @murphai/health-commons artifacts:r2:dry-run` completed; expected rights-policy blocks were reported for non-redistributable artifacts, with no structural failure.
- `pnpm --filter @murphai/health-commons typecheck` passed.
- `pnpm --filter @murphai/health-commons test:vitest` passed after updating the deterministic protocol-order fixture for the new collagen protocol.
- `git diff --check -- <touched health-commons content/test/planning files>` passed.
Completed: 2026-05-06
