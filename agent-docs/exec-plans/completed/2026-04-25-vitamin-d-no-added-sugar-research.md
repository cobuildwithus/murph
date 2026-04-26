# Vitamin D and no-added-sugar Health Commons research

Status: completed
Created: 2026-04-25
Updated: 2026-04-26

## Goal

- Start two separate Health Commons research workflows and carry them through final landing-package readiness:
  - vitamin D supplementation
  - no-added-sugar eating pattern
- Current success means both workspaces complete page-builder, QA, final reducer, local artifact validation, and any safe repo landing step explicitly requested by the user.

## Success criteria

- `output-packages/research/vitamin-d-supplementation` exists and is scoped as a supplementation family plus starter variant, not a clinical deficiency-treatment catch-all.
- `output-packages/research/no-added-sugar-diet` exists and is scoped around added-sugar avoidance/reduction, not ketogenic, low-carb, artificial-sweetener, or weight-loss diet bundles.
- Both charter prompts include explicit adjacent-exclusion guardrails before send.
- Each `01-charter` seam is sent through a named managed research lane and records `state/chat-urls/01-charter.txt`.
- Each `01-charter` seam is harvested, reviewed for modality boundaries, and materialized.
- All 12 discovery shard sends complete and record `state/chat-urls/<seam>.txt`.
- Discovery harvest artifacts are captured for all shards, with blockers called out explicitly instead of silently backfilling weak evidence.
- Vitamin D advances to snowball/gap-fill and source-ledger reduction once discovery coverage is locally validated.
- Vitamin D starts source extraction from reducer-produced batches once the canonical source ledger is validated.

## Scope

- In scope:
  - `output-packages/research/vitamin-d-supplementation/**`
  - `output-packages/research/no-added-sugar-diet/**`
  - `scripts/research-orchestrator/lib.mjs`
  - `scripts/research-init.test.ts`
  - this execution plan
  - the shared coordination ledger row for this research lane
- Out of scope:
  - Unrelated Health Commons content edits outside the returned final-reducer manifests.
  - Regenerating Health Commons generated catalog files beyond what final package landing and verification require.
  - Changing existing supplement, diet, protocol, source, or biomarker pages outside the vitamin D/no-added-sugar returned package scope.

## Constraints

- Preserve unrelated dirty work and active research harvests.
- Use workspace-specific research config and named managed browser lanes.
- Keep claims conservative and source-bound.
- Keep safety language stronger than efficacy language where evidence is mixed or thin.
- Do not expose local identifiers, secrets, or personal data in generated files, logs, commits, or handoff.

## Risks and mitigations

1. Risk: vitamin D evidence collapses general supplementation, deficiency correction, high-dose bolus therapy, sun exposure, fortified foods, and prescription analogs.
   Mitigation: Treat the workspace as a family plus starter supplement variant and require the charter to separate adjacent modalities.
2. Risk: "no sugar diet" turns into broad low-carb, ketogenic, ultra-processed-food, calorie restriction, artificial-sweetener, or diabetes medical nutrition therapy evidence.
   Mitigation: Scope the starter variant to no added sugars and preserve adjacent diet patterns until extraction proves otherwise.
3. Risk: Browser lanes are busy with existing research work.
   Mitigation: Use measured sends on named lanes and rely on workspace wake/harvest commands for long waits.

## Tasks

1. Initialize both research workspaces. Done.
2. Add charter scoping guardrails. Done.
3. Send both `01-charter` seams. Done on the `phlebas` lane.
4. Record thread URLs and current seam state. Done; each workspace has `state/chat-urls/01-charter.txt` and `state/seams/01-charter.json`.
5. Harvest both charter seams. Done.
6. Repair flattened machine-readable JSON blocks in the harvested response files so `research:materialize` can parse them. Done.
7. Materialize post-charter seams. Done.
8. Send all discovery shards with load balancing across managed browser lanes. Done.
9. Harvest discovery shards. Done: all 12 `source_candidates_v1.json` artifacts are present and valid.
10. Advance vitamin D to snowball/gap-fill. Done: `10-snowball-gap-fill` completed on `hercules`.
11. Advance vitamin D to source-ledger reduction. Done: `11-source-ledger-reducer` completed on `vonneumann`.
12. Start vitamin D source extraction. Done for reducer batches 001-009; all nine vitamin D extraction batches are harvested and validated.
13. Advance no-added-sugar to snowball/gap-fill. Done: `10-snowball-gap-fill` completed on `hercules`.
14. Advance no-added-sugar to source-ledger reduction. Done: `11-source-ledger-reducer` completed on `vonneumann`.
15. Start no-added-sugar source extraction. Done: batches `12-source-extraction-batch-001` through `12-source-extraction-batch-010` are all harvested and locally validated.
16. Start vitamin D section synthesis. Done: sections `20` through `23` are harvested and source-keyed `SECTION_CLAIMS_V1` blocks validated.
18. Start vitamin D page builder. Done: `30-page-builder` completed on `vonneumann` after local ZIP fallback normalization.
17. Verify generated workspace files and planning diff hygiene. Done for setup, materialization, discovery sends, and both reducer artifacts; extraction/synthesis verification is in progress.

## Current state

- `output-packages/research/vitamin-d-supplementation/state/seams/01-charter.json` shows send and harvest completed.
- `output-packages/research/no-added-sugar-diet/state/seams/01-charter.json` shows send and harvest completed.
- Both charters kept the requested boundaries and were materialized.
- Discovery sends are complete.
- Discovery harvest recovered all 12 shard artifacts:
  - vitamin D supplementation: direct-intervention (40), baseline-status (40), safety (40), adjacent-variants (58), population-subgroups (40), duration-and-latency (5)
  - no-added-sugar diet: direct-intervention (40), observational-consumption (60), substitution-strategies (40), behavioral-adherence (40), safety-and-burden (40), long-term-outcomes (40)
- Vitamin D next phase:
  - `10-snowball-gap-fill` completed on `hercules` with a 31-row addition/correction pass.
  - Snowball flagged bad duration/latency PMIDs and added CKD, calcifediol, absorption-with-meal, sleep-outcome, and monitoring-boundary clusters for reducer review.
  - `11-source-ledger-reducer` completed on `vonneumann` with 207 canonical source records and 9 extraction batches; the largest batch has 32 records.
  - `12-source-extraction-batch-001` completed on `eragon` for the 25-record dose-response / 25(OH)D maintenance batch.
  - `12-source-extraction-batch-002` completed on `hercules` for the 15-record clinical / immune outcome batch.
  - `12-source-extraction-batch-003` completed on `eragon` for the 32-record baseline-status / population-response-modifier batch.
  - `12-source-extraction-batch-004` completed on `vonneumann` for the 23-record routine/upper-end daily safety batch.
  - `12-source-extraction-batch-005` completed on `eragon` for the 27-record toxicity / CKD / active-analogue safety-boundary batch.
  - `12-source-extraction-batch-006` completed on `eragon` for the 20-record pharmacokinetics / D2 / calcifediol / route / formulation batch.
  - `12-source-extraction-batch-007` completed on `hercules` for the 24-record UVB / sunlight / fortified-food adjacent-variant batch.
  - `12-source-extraction-batch-008` completed on `eragon` for the 22-record guideline / screening / broad-review / registry-anchor batch.
  - `12-source-extraction-batch-009` completed on `hercules` for the 16-record intermittent / bolus / weekly / monthly schedule-variant batch.
  - `20-section-synthesis-dose-implementation` completed on `eragon` with 8 source-keyed `SECTION_CLAIMS_V1` claims for the dose / frequency / formulation / daily-administration section.
  - `21-section-synthesis-baseline-considerations` completed on `eragon` with 7 source-keyed `SECTION_CLAIMS_V1` claims for the baseline status / season / latitude / diet / sun-exposure section.
  - `22-section-synthesis-safety-monitoring` completed on `hercules` with 8 source-keyed `SECTION_CLAIMS_V1` claims for the monitoring / hypercalcemia / kidney-function / interaction section.
  - `23-section-synthesis-outcome-metrics` completed on `hercules` with 7 source-keyed `SECTION_CLAIMS_V1` claims for the lab / manual / self-reported outcome-metrics section.
  - `30-page-builder` completed on `vonneumann` after local ZIP fallback normalization; the protocol page, family page, artifact manifest, and package archive contract now validate.
  - `31-evidence-qa` and `32-safety-qa` completed on `vonneumann` and both block landing as-is with concrete reducer fixes.
  - `34-final-landing-reducer` was first sent on `vonneumann`, but that thread reported a wrong-context snapshot with only the no-added-sugar package visible. Its local wake runner was stopped, and the seam was resent on `mountain` with a fresh URL for the QA-integrated final package; a later local wake failure while the remote thread was still busy was recovered by restarting harvest against the same Mountain URL without resending.
- No-added-sugar retry state for substitution-strategies:
  - Vonneumann resend completed but harvest stalled in repeated partial active snapshots without an artifact.
  - Eragon resend later harvested successfully with 40 normalized `source_candidates_v1.json` records.
  - `10-snowball-gap-fill` completed on `hercules` with a 30 KB snowball/correction response. It reports 260 discovery candidate rows collapsing to 205 unique source keys before additions/corrections.
  - `11-source-ledger-reducer` completed on `vonneumann` with 214 canonical source records and 10 extraction batches; the largest batch has 36 records.
  - `12-source-extraction-batch-001` completed on `vonneumann` for the 14-record direct free/added-sugar reduction and clinical-protocol-anchor batch.
  - `12-source-extraction-batch-002` completed on `hercules` for the 32-record sugar-sweetened-beverage intervention batch.
  - `12-source-extraction-batch-003` completed on `hercules` for the 16-record behavioral adherence / craving / burden / implementation batch.
  - `12-source-extraction-batch-004` completed on `hercules` for the 15-record mechanism / physiology / sweet-taste-adaptation batch.
  - `12-source-extraction-batch-005` completed on `vonneumann` for the 17-record guidelines / systematic-synthesis / labeling batch.
  - `12-source-extraction-batch-006` completed on `vonneumann` for the 25-record observational long-term cohort / dose-response batch.
  - `12-source-extraction-batch-007` completed on `eragon` for the 20-record non-sugar-sweetener / diet-beverage substitution batch.
  - `12-source-extraction-batch-008` completed on `vonneumann` for the 36-record safety / special-populations batch.
  - `12-source-extraction-batch-009` completed on `hercules` for the 19-record adjacent dietary-pattern / beverage-observational / ultra-processed / combination-protocol batch.
  - `12-source-extraction-batch-010` completed on `vonneumann` for the 20-record sweetener safety / long-term observational / fruit-juice-boundary batch.
  - Section-synthesis command wrappers are prepared for `20-section-synthesis-dose-implementation`, `21-section-synthesis-adherence-support`, `22-section-synthesis-safety-and-special-populations`, and `23-section-synthesis-outcome-monitoring`.
  - `20-section-synthesis-dose-implementation` completed on `vonneumann` with 10 source-keyed `SECTION_CLAIMS_V1` claims for the implementation / substitution-strategy section.
  - `21-section-synthesis-adherence-support` completed on `eragon` with 9 source-keyed `SECTION_CLAIMS_V1` claims for the behavioral strategies / counseling / tracking-adherence section.
  - `22-section-synthesis-safety-and-special-populations` completed on `eragon` with 8 source-keyed `SECTION_CLAIMS_V1` claims for the safety / hypoglycemia / nutrient-deficiency / psychosocial-stress section.
  - `23-section-synthesis-outcome-monitoring` completed on `vonneumann` with 9 source-keyed `SECTION_CLAIMS_V1` claims for the intake / glycemic / weight / dental / craving / replacement-monitoring section.
  - `30-page-builder` send failed once on `vonneumann` before recording a ChatGPT URL, then succeeded on `eragon`; harvest completed after local manifest/ZIP fallback normalization and the page-builder artifact contract validates.
  - `31-evidence-qa` completed on `eragon` with a block-until-edits verdict covering sleep-efficiency overreach, operational-run defaults, food-log measurement wording, SSB directness, Boxall RCT weighting, CVD null-evidence source mapping, ClinicalTrials key stability, and finding classification/directness cleanup.
  - `32-safety-qa` completed on `hercules` with a block-until-edits-land safety report covering diabetes/medication routing, nutrition-risk groups, acute illness, eating-disorder/psychosocial risk, pregnancy/lactation/child/adolescent routing, and strictness drift.
  - `34-final-landing-reducer` completed on `hercules` with manifest, patch, source ledger, checklist, punchlist, and ZIP outputs. ZIP integrity and JSON parsing passed.
  - The no-added patch applied after excluding the pre-existing `body-weight` biomarker hunk; `body-weight` was manually generalized to preserve the existing creatine relation and add no-added-sugar context. Local sanity checks pass: 214 source pages, 204 artifact entries, no old ClinicalTrials key, no sleep-efficiency references, and scoped diff whitespace is clean.
  - Local Health Commons generation blockers from the no-added package were resolved: compact YAML map-list items were normalized, duplicate family/protocol aliases were split by scope, the existing canonical `source_artifact:pmid-28919842` source page was reused instead of keeping a duplicate source page, and 113 standalone no-added-sugar evidence-appraisal edges were added for the research-landscape groups. `pnpm --filter @murphai/health-commons generate` now passes for the applied no-added-sugar package.
  - Duplicate stale local harvest runners targeting older ChatGPT URLs were stopped, and a duplicate local Mountain wake runner for the current vitamin D final reducer URL was also stopped so only one current wake loop remains.
  - The current recorded vitamin D final reducer URL is the `mountain` resend after the Vonneumann wrong-context thread was abandoned.
- Lane distribution:
  - Vonneumann: vitamin D direct, vitamin D baseline-status, no-added-sugar behavioral-adherence, vitamin D population-subgroups
  - Hercules: no-added-sugar direct, vitamin D safety, no-added-sugar safety-and-burden
  - Phlebas: no-added-sugar observational-consumption, no-added-sugar substitution-strategies, vitamin D duration-and-latency
  - Eragon: vitamin D adjacent-variants, no-added-sugar long-term-outcomes
- Browser-lane note: initial parallel wake/export hung on stale tabs. Manual recovery used tab reset plus one-shot harvest, with Phlebas used only for harvest of already-sent Phlebas seams and no new Phlebas sends.
- Next step is to harvest vitamin D `34-final-landing-reducer`, apply/merge its returned package, then rerun Health Commons generation/check/dry-run and repo verification over the combined landing.

## Verification

- `git diff --check -- agent-docs/exec-plans/completed/2026-04-25-vitamin-d-no-added-sugar-research.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- Direct readback of each workspace `workflow.json`, `prompts/01-charter.md`, and `state/chat-urls/01-charter.txt` when send succeeds.
- Setup verification completed:
  - planning diff whitespace check passed
  - both chat URL files are present
  - both `workflow.json` files parse as `charter_pending`
  - both seam state files show completed send
- Poll/materialization verification completed:
  - both seam state files show completed harvest
  - `pnpm research:materialize --workspace output-packages/research/vitamin-d-supplementation` passed
  - `pnpm research:materialize --workspace output-packages/research/no-added-sugar-diet` passed
- Discovery-send verification completed:
  - all 12 discovery seam state files show `send=completed`
  - all 12 discovery seams have persisted chat URLs
  - privacy scan over both research workspaces passed after send
- Discovery-harvest verification in progress:
  - 12 `source_candidates_v1.json` artifacts parse with a `records` array
- Vitamin D snowball/reducer verification in progress:
  - `10-snowball-gap-fill` exported a final `assistant-response.md`
  - `11-source-ledger-reducer` produced valid `canonical_source_ledger_v1.json` and `source_extraction_batches_v1.json`
  - canonical ledger has 207 records; extraction batches have 9 batches, max 32 records; 3 invalid duration/latency rows are excluded and not batched
  - `12-source-extraction-batch-001` produced a source-extraction package with 25 source drafts, 42 atomic findings, and 25 artifact candidates
  - `12-source-extraction-batch-002` produced a source-extraction package with 15 source drafts, 42 atomic findings, and 15 artifact candidates
  - `12-source-extraction-batch-003` produced a source-extraction package with 32 source drafts, 53 atomic findings, and 32 artifact candidates
  - `12-source-extraction-batch-004` produced a source-extraction package with 23 source drafts, 44 atomic findings, and 23 artifact candidates
  - `12-source-extraction-batch-005` produced a source-extraction package with 27 source drafts, 29 atomic findings, and 27 artifact candidates
  - `12-source-extraction-batch-006` produced a source-extraction package with 20 source drafts, 28 atomic findings, and 20 artifact candidate entries
  - `12-source-extraction-batch-007` produced a source-extraction package with 24 source drafts, 24 atomic findings, and 24 artifact candidates
  - `12-source-extraction-batch-008` produced a source-extraction package with 22 source drafts, 27 atomic findings, and 22 artifact candidates
  - `12-source-extraction-batch-009` produced a source-extraction package with 16 source drafts, 33 atomic findings, and 16 artifact candidates
  - `20-section-synthesis-dose-implementation` produced a final response with `SECTION_CLAIMS_V1` for `sectionId: dose-implementation`, 8 claims, and source keys on every claim
  - `21-section-synthesis-baseline-considerations` produced a final response with `SECTION_CLAIMS_V1` for `sectionId: baseline-considerations`, 7 claims, and source keys on every claim
  - `22-section-synthesis-safety-monitoring` produced a final response with `SECTION_CLAIMS_V1` for `sectionId: safety-monitoring`, 8 claims, and source keys on every claim
  - `23-section-synthesis-outcome-metrics` produced a final response with `SECTION_CLAIMS_V1` for `sectionId: outcome-metrics`, 7 claims, and source keys on every claim
  - `30-page-builder` produced a validated page-builder package after local ZIP fallback normalization: protocol page, family page, artifact manifest, and package archive are all present, and the package ZIP integrity check passes
  - `31-evidence-qa` completed with `Verdict: block landing as-is` and concrete reducer edits
  - `32-safety-qa` completed with `Safety QA verdict: BLOCK` and concrete reducer edits
  - `34-final-landing-reducer` completed on `mountain`; final ZIP integrity, JSON/JSONL parsing, diff application, frontmatter parsing, and local landing checks passed after canonical source dedupe/appraisal fixes.
- No-added-sugar snowball/reducer verification in progress:
  - `10-snowball-gap-fill` exported a final `assistant-response.md`
  - `11-source-ledger-reducer` produced valid `canonical_source_ledger_v1.json` and `source_extraction_batches_v1.json`
  - canonical ledger has 214 records; extraction batches have 10 batches, max 36 records
  - `12-source-extraction-batch-001` produced a source-extraction package with 14 source drafts, 37 atomic findings, and 14 artifact candidates
  - `12-source-extraction-batch-002` produced a source-extraction package with 32 source drafts, 33 atomic findings, and 32 artifact candidates
  - `12-source-extraction-batch-003` produced a source-extraction package with 16 source drafts, 38 atomic findings, and 16 artifact candidates
  - `12-source-extraction-batch-004` produced a source-extraction package with 15 source drafts, 45 atomic findings, and 15 artifact candidates
  - `12-source-extraction-batch-005` produced a source-extraction package with 17 source drafts, 36 atomic findings, and 17 artifact candidates
  - `12-source-extraction-batch-006` produced a source-extraction package with 25 source drafts, 50 atomic findings, and 25 artifact candidates
  - `12-source-extraction-batch-007` produced a source-extraction package with 20 source drafts, 40 atomic findings, and 20 artifact candidates
  - `12-source-extraction-batch-008` produced a validated source-extraction package with 36 source drafts, 36 atomic findings, and 36 artifact candidates
  - `12-source-extraction-batch-009` produced a source-extraction package with 19 source drafts, 49 atomic findings, and 19 artifact candidates
  - `12-source-extraction-batch-010` produced a validated source-extraction package with 20 source drafts, 40 atomic findings, and 20 artifact candidates
  - `20-section-synthesis-dose-implementation` produced a final response with `SECTION_CLAIMS_V1` for `sectionId: dose-implementation`, 10 claims, and source keys on every claim
  - `21-section-synthesis-adherence-support` produced a final response with `SECTION_CLAIMS_V1` for `sectionId: adherence-support`, 9 claims, and source keys on every claim
  - `22-section-synthesis-safety-and-special-populations` produced a final response with `SECTION_CLAIMS_V1` for `sectionId: safety-and-special-populations`, 8 claims, and source keys on every claim
  - `23-section-synthesis-outcome-monitoring` produced a final response with `SECTION_CLAIMS_V1` for `sectionId: outcome-monitoring`, 9 claims, and source keys on every claim
  - `30-page-builder` send failed once on `vonneumann` before recording a ChatGPT URL, then succeeded on `eragon`; artifact contract validates after local manifest/ZIP fallback normalization
  - `31-evidence-qa` completed on `eragon` with block-landing evidence edits
  - `32-safety-qa` completed on `hercules` with block-landing safety edits
  - `34-final-landing-reducer` completed on `hercules`; final artifacts were validated, applied, canonicalized against existing source pages, and included in the combined Health Commons verification pass.
  - Combined landing verification passed:
    - `pnpm --filter @murphai/health-commons generate`
    - `pnpm --filter @murphai/health-commons generate:check`
    - `pnpm --filter @murphai/health-commons artifacts:r2:dry-run`
    - `pnpm exec vitest run --config scripts/vitest.config.ts scripts/research-init.test.ts --no-coverage`
    - `pnpm --filter @murphai/health-commons test`
    - `pnpm typecheck`
    - `pnpm test:smoke`
  - Scoped privacy scan over touched research/content/code paths passed after redacting local paths from research workflow logs/status files.
Completed: 2026-04-26
