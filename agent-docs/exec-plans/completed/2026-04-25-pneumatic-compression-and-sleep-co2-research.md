# Pneumatic compression and sleep CO2 Health Commons research setup

Status: active
Created: 2026-04-25
Updated: 2026-04-26

## Goal

- Start two separate Health Commons research workflows from the user's prompt:
  - intermittent pneumatic compression pants as a recovery/circulation protocol family
  - sleep-room CO2/ventilation as an environmental sleep exposure protocol family
- Success means both workspaces are initialized, their charter seams are submitted or a concrete send blocker is recorded, and the next phase is clear without landing live Health Commons pages yet.

## Success criteria

- `output-packages/research/pneumatic-compression-pants` exists with a charter-first scaffold.
- `output-packages/research/sleep-room-co2-ventilation` exists with a charter-first scaffold.
- Each workspace has a persisted `01-charter` thread URL after send, or a specific send/login/browser blocker is recorded.
- The two charters keep modality boundaries explicit and do not merge device compression with sleep air-quality exposure.
- Direct readback confirms each `workflow.json`, `prompts/01-charter.md`, and send result state is internally consistent.

## Scope

- In scope:
  - Research setup under `output-packages/research/pneumatic-compression-pants/**`.
  - Research setup under `output-packages/research/sleep-room-co2-ventilation/**`.
  - Charter scoping guardrails for adjacent exclusions and likely outcomes.
- Out of scope:
  - Editing live Health Commons family/protocol/source pages.
  - Regenerating or committing Health Commons generated catalog files.
  - Collapsing compression-device evidence with massage garments, manual compression, or clinical DVT prophylaxis unless the charter explicitly supports that boundary.
  - Collapsing sleep CO2 exposure with all sleep hygiene, travel/beach effects, room temperature, noise, humidity, light exposure, air purification, or supplemental oxygen unless the charter explicitly supports that boundary.

## Constraints

- Preserve unrelated dirty work and active research lanes in the shared checkout.
- Use the repo research orchestrator and workspace-specific review-gpt configs.
- Prefer named managed browser lanes with measured launch timing.
- Keep claims evidence-led and conservative, especially for HRV, sleep architecture, cardiovascular outcomes, thrombosis risk, and respiratory safety.
- Do not expose local identifiers, secrets, raw credentials, or direct personal identifiers in files, logs, commits, or handoff.

## Risks and mitigations

1. Risk: Pneumatic compression pants evidence may mix sports recovery, edema/lymphedema, DVT prophylaxis, peripheral artery disease, and consumer wellness devices.
   Mitigation: Start with a family plus starter variant and require the charter to keep supervised clinical indications and consumer recovery protocols separate.
2. Risk: Sleep CO2 evidence may over-attribute a beach-window-open HRV observation to CO2 while confounders are substantial.
   Mitigation: Frame the user observation as a hypothesis generator only; require the charter to separate CO2/ventilation from travel, temperature, humidity, light, sound, stress, and activity changes.
3. Risk: Research seams can run for a long time and look idle while still working.
   Mitigation: Use the generated send/harvest wrappers and record exact state rather than duplicating threads.

## Tasks

1. Initialize both research workspaces.
2. Review the generated charter prompts for scoping guardrails.
3. Send both `01-charter` seams on named managed lanes, staggering launches if needed. Done.
4. Confirm persisted thread URLs or record blockers. Done.
5. Decide whether to start harvests immediately or leave the long-polling phase as the next step. Done: leave harvest as the next explicit phase because the user asked to start the workflow and charter harvest can occupy a browser lane for a long time.
6. Harden `scripts/research-materialize.mjs` so recovered charter responses with `JSON` label blocks parse without manual fence repair. Done.
7. Send sleep-room CO2 discovery shards and harvest their `SOURCE_CANDIDATES_V1` artifacts. Done.
8. Send and harvest pneumatic compression discovery shards. Done; Phlebas originals were replaced with Mountain sends after thread-load failures.
9. Run sleep-room CO2 snowball/gap-fill on a non-`phlebas` lane. Done on `hercules`.
10. Run sleep-room CO2 source-ledger reducer on a non-`phlebas` lane. Done on `vonneumann`.
11. Prepare, send, and harvest sleep-room CO2 extraction batch `batch-001`. Done on `hercules`.
12. Continue sleep-room CO2 extraction batches from the reducer output. Done: all canonical batches `batch-001` through `batch-012` are harvested or locally recovered into normalized canonical artifacts.
13. Run sleep-room CO2 section synthesis seams from the completed extraction corpus. Done: all 11 section synthesis seams were sent on non-`phlebas` lanes, harvested, and validated for structured claims.
14. Run sleep-room CO2 page-builder package seam. Done on `eragon`; the package ZIP filename was manually backfilled to the workflow contract name after harvest downloaded an equivalent ZIP under a different assistant-chosen name.
15. Run sleep-room CO2 evidence and safety QA seams. Done on non-`phlebas` lanes; both canonical QA responses landed with blocker findings for final reducer.
16. Run pneumatic compression snowball/gap-fill. Done on `mountain`; response includes 15 addition candidates plus correction, gap-diagnosis, and variant-split notes.
17. Run pneumatic compression source-ledger reducer. Done on `mountain`; output contains 271 ledger records, 260 batched extraction records, 11 intentionally excluded records, and 12 batches.
18. Prepare, send, and harvest pneumatic compression extraction batch `batch-001`. Done on `mountain`; inline response was locally recovered into normalized source-page drafts, atomic findings, and artifact candidates.
19. Send and harvest pneumatic compression extraction batch `batch-002`. Done on `mountain`; downloadable artifacts normalized and validated for all 29 expected source keys.
20. Send pneumatic compression extraction batches `batch-003` through `batch-012`. Done on `phlebas` after selecting it as the most-open browser lane at the check time.
21. Harvest pneumatic compression extraction batches `batch-003` through `batch-012` in parallel. Done on `phlebas`; batches `005` and `012` needed local normalized-file recovery from valid downloaded artifacts, and all 12 extraction batches now validate.
22. Run pneumatic compression section synthesis seams from the completed extraction corpus. Done on `mountain`; all 10 section seams were harvested as substantive inline responses and validated for source-keyed claims.
23. Run pneumatic compression page-builder package seam. In progress on `mountain`; the existing wake loop is still polling the original thread and has not yet produced required downloads.
24. Prepare pneumatic evidence QA and safety QA seams. Done; prompts and command wrappers are materialized and syntax-checked, but sends are blocked until the page-builder package lands.

## Decisions

- Use `intermittent-pneumatic-compression` as the provisional family and `pneumatic-compression-pants` as the starter protocol slug.
- Use `sleep-air-quality` as the provisional family and `sleep-room-co2-ventilation` as the starter protocol slug.
- Treat the user's beach/open-window/low-CO2 HRV observation as an N-of-1 hypothesis, not evidence of causality.

## Current state

- `output-packages/research/pneumatic-compression-pants` initialized and `01-charter` sent on lane `vonneumann`.
- `output-packages/research/sleep-room-co2-ventilation` initialized and `01-charter` sent on lane `eragon`.
- Both workspaces have `state/chat-urls/01-charter.txt`, `state/seams/01-charter.json`, `state/thread-exports/01-charter.thread.json`, and `responses/01-charter.md`.
- Both charter responses needed a formatting-only repair from `JSON` labels to fenced `json` blocks before `research:materialize` could parse the required machine-readable blocks.
- Both workspaces are materialized and ready for discovery shard sends.
- Pneumatic compression materialized 10 discovery shards and 10 section seams.
- Sleep-room CO2 ventilation materialized 10 discovery shards and 11 section seams.
- `scripts/research-materialize.mjs` now accepts both fenced `json` blocks and recovered `JSON` label blocks, with focused test coverage in `scripts/research-init.test.ts`.
- `scripts/research-orchestrator/lib.mjs` now treats an unavailable browser target list during post-harvest tab cleanup as a skipped cleanup while preserving warnings for close failures on matched tabs.
- Sleep-room CO2 ventilation discovery shards `02` through `11` were sent and harvested; each has `harvest=completed` and a normalized `source_candidates_v1.json` artifact with no missing artifact-contract entries.
- Pneumatic compression discovery shards `02` through `11` were originally sent on lane `phlebas`; Phlebas harvest attempts for `02` through `04` failed to load thread content. Shards `02` through `11` were resent on lane `mountain` with `RESEARCH_MODEL=pro` on 2026-04-25, harvested on Mountain, and each normalized `source_candidates_v1.json` contains 40 records.
- Pneumatic compression snowball/gap-fill prompt and command wrappers were added; `10-snowball-gap-fill` was sent and harvested on lane `mountain`, producing `responses/10-snowball-gap-fill.md` with 15 newly found candidate records plus duplicate-key corrections, source-coverage diagnosis, and variant split notes.
- Pneumatic compression source-ledger reducer prompt and command wrappers were added; `11-source-ledger-reducer` was sent and harvested on lane `mountain`, producing normalized `canonical_source_ledger_v1.json` and `source_extraction_batches_v1.json`.
- Pneumatic compression source-ledger reducer output contains 271 unique source records: 260 extraction-batched records, 11 intentionally excluded `do-not-use` records, and 12 extraction batches. Local consistency validation found no duplicate source keys, no missing core fields, no non-excluded ledger records missing extraction-batch membership, no batch keys missing from the ledger, and no batch over 40 records.
- Pneumatic compression extraction prompt and command wrappers were added for all 12 source-extraction batches, with workflow artifact contracts for source-page drafts, `ATOMIC_FINDINGS_V1`, and `ARTIFACT_CANDIDATES_V1`.
- Pneumatic compression extraction `batch-001` covers 5 direct post-exercise recovery reviews/evidence maps. It was sent on lane `mountain`; the workspace config initially inherited the Hercules browser binary, so the successful retry used an explicit Mountain browser-binary override. The harvest returned inline text rather than downloadable artifacts, then local recovery normalized `source-page-drafts-batch-001.md`, `ATOMIC_FINDINGS_V1-batch-001.json`, and `ARTIFACT_CANDIDATES_V1-batch-001.json`.
- Pneumatic compression extraction `batch-001` produced 5 source-page drafts, 27 atomic findings, and 5 artifact candidates; local validation found source coverage for all 5 expected batch source keys and no artifact-contract misses after inline recovery.
- Pneumatic compression extraction `batch-002` covers 29 direct completed lower-limb sports-recovery trials and dose studies. It was sent and harvested on lane `mountain`, producing normalized `source-page-drafts-batch-002.md`, `ATOMIC_FINDINGS_V1-batch-002.json`, and `ARTIFACT_CANDIDATES_V1-batch-002.json`.
- Pneumatic compression extraction `batch-002` produced 29 source-page drafts, 116 atomic findings, and 29 artifact candidates; local validation found source coverage for all 29 expected batch source keys and no artifact-contract misses.
- Pneumatic compression extraction batches `batch-003` through `batch-012` were sent on `phlebas` after the lane check showed it was the most-open browser profile, with 2 ChatGPT tabs and no visible stop-streaming threads at check time. Sends were staged serially because one browser profile has one composer surface, then harvests were run in parallel.
- Pneumatic compression extraction `batch-005` returned valid downloaded findings, candidates, and source-page drafts, but the source-page draft attachment used an assistant-chosen filename. It was copied into the normalized contract path and the seam was marked recovered from downloaded attachment.
- Pneumatic compression extraction `batch-012` returned valid downloaded findings/candidates plus a ZIP, but attachment names did not match the contract. The source-page drafts were recovered from the ZIP, JSON artifacts were copied into normalized contract paths, and the seam was marked recovered from downloaded ZIP.
- Pneumatic compression canonical extraction status is 12/12 batches complete: 260 source-page drafts, 647 atomic findings, and 260 artifact candidates across normalized canonical batch artifacts. Local validation found source coverage for all 260 expected batched source keys and no artifact-contract misses.
- Pneumatic compression section synthesis seams `20-section-synthesis-scope-variant-boundaries` through `29-section-synthesis-experiment-onboarding` were sent and harvested on `mountain`. Local validation found 10 substantive section responses, 77 total claims, every response matched its section ID, every claim carried source keys, source keys resolved to the canonical ledger, and referenced finding IDs resolved to extracted findings.
- Pneumatic compression page-builder seam `30-page-builder` was sent on `mountain`. The wake loop is active against the original thread, currently reports a busy `stop-visible` state, and has not yet downloaded the required protocol page, family page, artifact manifest, or package ZIP.
- Pneumatic compression evidence QA and safety QA prompts/wrappers are materialized as `31-evidence-qa` and `32-safety-qa`. They should be sent only after `30-page-builder` produces the expected package artifacts.
- Sleep-room CO2 snowball/gap-fill prompt and command wrappers were added; `10-snowball-gap-fill` was sent and harvested on lane `hercules`, producing `responses/10-snowball-gap-fill.md`.
- Sleep-room CO2 source-ledger reducer prompt and command wrappers were added; `11-source-ledger-reducer` was sent and harvested on lane `vonneumann`, producing normalized `canonical_source_ledger_v1.json` and `source_extraction_batches_v1.json`.
- Sleep-room CO2 source-ledger reducer output contains 245 unique source records and 12 extraction batches; local consistency validation found no duplicate source keys, no missing required fields, no batch over 40 records, and no ledger keys missing from batch membership.
- Sleep-room CO2 extraction prompt and command wrappers were added for `12-source-extraction-batch-001`; it was sent and harvested on lane `hercules`, producing normalized source page drafts, `ATOMIC_FINDINGS_V1-batch-001.json`, and `ARTIFACT_CANDIDATES_V1-batch-001.json`.
- Sleep-room CO2 extraction `batch-001` covers 12 direct controlled CO2 / room-ventilation sleep sources and produced 53 atomic findings plus 12 artifact candidates.
- Sleep-room CO2 extraction batches `batch-002` through `batch-007` and `batch-009` through `batch-012` were sent/harvested on non-`phlebas` lanes and validated with all required normalized artifacts.
- Sleep-room CO2 `batch-008` was recovered after the full-batch, resend, split `24-source-extraction-batch-008a`, and older micro-splits `26-source-extraction-batch-008a1`/`27-source-extraction-batch-008a2` stalled. New micro-splits `28-source-extraction-batch-008a3` through `32-source-extraction-batch-008a7` completed the first 17 sources, and previously completed split `25-source-extraction-batch-008b` covered the remaining 16 sources.
- Sleep-room CO2 canonical extraction status is 12/12 batches complete: 531 atomic findings and 256 artifact candidates across normalized canonical batch artifacts.
- Operator note, 2026-04-25: one-source fallback seams `33-source-extraction-batch-008a4s1` through `35-source-extraction-batch-008a4s3` were sent while `29-source-extraction-batch-008a4` was still polling, then their local harvest watchers were stopped after `29-source-extraction-batch-008a4` completed. They are redundant and are not part of the canonical merged `batch-008` artifact set.
- Sleep-room CO2 section synthesis seams `20-section-synthesis-scope-boundaries` through `30-section-synthesis-experiment-onboarding` were sent on non-`phlebas` lanes and harvested. All 11 responses are present and include structured claim JSON with correct section IDs and source-keyed claims.
- Sleep-room CO2 page-builder seam `30-page-builder` completed on `eragon` after schema-cleanup iterations. Harvest downloaded the protocol page draft, family page draft, overnight-bedroom-CO2 biomarker page, source page manifest, package report, non-claims file, artifact manifest, and package ZIP. The assistant named the ZIP `sleep-room-co2-health-commons-package.zip`; it was copied to the workflow-contract filename `sleep-air-quality-package-draft.zip` and the local artifact-contract state was backfilled.
- Sleep-room CO2 evidence QA `31-evidence-qa` and safety QA `32-safety-qa` completed. Evidence QA blocks landing as-is on threshold wording, outdoor-air disposition, one source-key mismatch, missing threshold/CO2-interpretation source pages, and null/mixed finding classifications. Safety QA blocks landing as-is on combustion/CO safety, PAP/NIV/oxygen users, deliberate CO2 delivery/rebreathing, high/alarming CO2 readings, and fan/filter/electrical hazards. Controlled retry QA threads were started after the originals appeared stalled, but the canonical originals completed first and retry local watchers were stopped.

## Verification

- Direct readback of both `workflow.json` files and `prompts/01-charter.md`.
- Confirm `state/chat-urls/01-charter.txt` exists for each sent charter, or record the send blocker.
- `git diff --check -- agent-docs/exec-plans/active/2026-04-25-pneumatic-compression-and-sleep-co2-research.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `node --check scripts/research-materialize.mjs` passed.
- `node --check scripts/research-orchestrator/lib.mjs` passed.
- `pnpm exec vitest run scripts/research-init.test.ts --config scripts/vitest.config.ts --no-coverage` passed: 19 tests.
- `pnpm typecheck` passed.
- `pnpm test:smoke` passed: 151 scenarios, 6 sample inputs, 22 golden-output directories.
- Pneumatic compression extraction all-batch validation passed: 12/12 canonical extraction batches, every expected source key had a draft source page, findings, and artifact candidates, and totals were 260 source-page drafts, 647 atomic findings, and 260 artifact candidates. Batches `003` through `012` used `phlebas` for send/harvest, while `batch-005` and `batch-012` were locally recovered from valid downloaded artifacts because assistant filenames did not match the workflow contract.
- Sleep-room CO2 reducer local consistency validation passed: 245 records, 12 batches, no duplicate source keys, no missing required fields, no batch over 40 records, and no ledger key missing from batch membership.
- Sleep-room CO2 extraction `batch-001` validation passed: three required artifacts normalized, `batchId` matched for findings and candidates, all 12 expected source keys had findings/candidates and draft source pages, and no duplicate finding IDs were found.
- Sleep-room CO2 extraction batches `batch-002` through `batch-007` and `batch-009` through `batch-012` validation passed with the required normalized source-page drafts, atomic findings, and artifact candidates.
- Sleep-room CO2 split `batch-008b` validation passed with required normalized artifacts, 32 findings, and 16 artifact candidates.
- Sleep-room CO2 recovery micro-splits `batch-008a3` through `batch-008a7` validation passed and were merged with `batch-008b` into canonical `batch-008`: 33/33 sources covered, 91 findings, and 33 artifact candidates.
- Sleep-room CO2 all-batch validation passed: 12/12 canonical extraction batches, every expected source key had findings and candidates, total 531 findings and 256 artifact candidates.
- Early QA while `batch-008` was stalled passed: extraction wrapper `bash -n`, artifact-contract checks, `node --check scripts/research-materialize.mjs`, `node --check scripts/research-orchestrator/lib.mjs`, focused `scripts/research-init.test.ts`, `pnpm typecheck`, `pnpm test:smoke`, `git diff --check`, and a privacy scan for local path leakage in the CO2 workspace.
- Post-recovery QA passed: new wrapper `bash -n`, `workflow.json` parse, `git diff --check`, and CO2 workspace privacy scan.
- Sleep-room CO2 section synthesis validation passed: all 11 response files exist, each section claim JSON parsed successfully with the expected section ID, non-empty claims, and no source-keyless claims.
- Sleep-room CO2 page-builder validation passed: required artifacts present, artifact contract backfilled to 4/4 normalized artifacts, package ZIP integrity passed, extracted ZIP contains 264 files including 245 source pages, protocol/family/artifact/biomarker drafts are present, protocol references 82 source keys that all resolve to drafted source pages, and artifact manifest has 256 entries whose source keys resolve to drafted source pages.
- Sleep-room CO2 QA validation passed: canonical evidence and safety QA responses exist, are substantive, and include required blocker-review sections plus exact text-edit guidance.
- Pneumatic compression section synthesis validation passed: all 10 response files exist, section IDs match expected prompts, 77 total claims parsed, every claim has source keys, source keys resolve to the 271-record canonical ledger, and finding IDs resolve to the 647 extracted findings.
- Pneumatic compression QA seam preparation checks passed: `bash -n` on four QA command wrappers, unresolved-placeholder scan on the two QA prompts and wrappers, and scoped `git diff --check` on touched research plan, ledger, prompt, and wrapper files.
