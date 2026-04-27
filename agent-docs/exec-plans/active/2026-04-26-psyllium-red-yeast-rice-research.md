# Psyllium husk and red yeast rice Health Commons research

Status: active
Created: 2026-04-26
Updated: 2026-04-27

## Goal

- Run and land two separate Health Commons research workflows:
  - psyllium husk for cholesterol
  - red yeast rice for cholesterol
- Success means each workspace advances through final reducer review with separate cholesterol-specific boundaries, landed Health Commons content, generated catalogs that validate, required completion audits addressed, and any unrelated repo blockers documented.

## Success criteria

- `output-packages/research/psyllium-husk-for-cholesterol` exists and is scoped around soluble-fiber psyllium supplementation for cholesterol/lipids, not a broad fiber, laxative, microbiome, weight-loss, or constipation catch-all.
- `output-packages/research/red-yeast-rice-for-cholesterol` exists and is scoped around red yeast rice as a supplement for cholesterol/lipids, with explicit separation from prescription statins, isolated monacolin K/lovastatin treatment, contaminated/adulterated products, and clinician-managed lipid therapy.
- Both charter prompts include explicit adjacent-exclusion guardrails before send.
- Each `01-charter` seam is sent through a named managed research lane and records `state/chat-urls/01-charter.txt`.
- Final reducer content is landed or locally reconciled into `packages/health-commons/content/**`.
- Health Commons generation, generated-output check, package typecheck/test, R2 dry-run, privacy scan, and required completion audits pass or have documented unrelated blockers.

## Scope

- In scope:
  - `output-packages/research/psyllium-husk-for-cholesterol/**`
  - `output-packages/research/red-yeast-rice-for-cholesterol/**`
  - `packages/health-commons/content/{artifacts,biomarkers,evidence-appraisals,families,protocols,sources}/**`
  - this execution plan
  - the shared coordination ledger row for this research lane
- Out of scope:
  - Committing unrelated active Health Commons research lanes.
  - Committing generated `packages/health-commons/generated/**` files.
  - Editing unrelated supplement, diet, protocol, source, or biomarker pages outside duplicate-source/biomarker canonicalization needed for this landing.

## Constraints

- Preserve unrelated dirty work and active research harvests.
- Use workspace-specific research config and named managed browser lanes.
- Keep claims conservative and source-bound.
- Keep safety language stronger than efficacy language where evidence is mixed or thin.
- Do not expose local identifiers, secrets, or personal data in generated files, logs, commits, or handoff.

## Risks and mitigations

1. Risk: psyllium research collapses all dietary fiber, constipation treatment, weight-loss, microbiome, and gut-symptom uses into the cholesterol protocol.
   Mitigation: Treat the workspace as a supplement protocol for lipid outcomes and require the charter to keep adjacent fiber and GI-use variants separate.
2. Risk: red yeast rice research collapses supplement evidence with prescription statin therapy or ignores product-quality/statin-like safety issues.
   Mitigation: Require the charter to separate supplement product variability, monacolin K exposure, citrinin/adulteration risk, and clinician-managed lipid therapy from the starter protocol.
3. Risk: Browser lanes are busy with existing research work.
   Mitigation: Use measured sends on named lanes and rely on workspace wake/harvest commands for long waits.

## Tasks

1. Initialize both research workspaces. Done.
2. Add charter scoping guardrails. Done.
3. Send both `01-charter` seams. Done.
4. Record thread URLs and current seam state. Done.
5. Verify generated workspace files and planning diff hygiene. Done for setup/send.
6. Harvest and materialize both charters. Done.
7. Send and harvest discovery shards. Done except psyllium `08-discovery-mechanism-viscosity-bile-acid`, which failed to export after alternate-lane recovery.
8. Run snowball/gap-fill seams. Done.
9. Prepare and run source-ledger reducers. Done.
10. Materialize and fan out source-extraction batches. Done.
11. Materialize and fan out section-synthesis seams. Done.
12. Prepare page-builder and QA seams. Done.
13. Harvest remaining QA seams on verified recorded lanes. Done.
14. Send final landing reducers after both QA pairs are complete. Done.
15. Inspect final reducer packages against the current Health Commons content landing candidate. Done.

## Current state

- Both charters were harvested, normalized from flattened label/JSON blocks, validated, and materialized into discovery and later-stage templates.
- All discovery sends completed across both workspaces.
- Red yeast rice discovery is fully harvested: 10/10 source-candidate artifacts parse with non-empty records. `06-discovery-safety-adverse-events` was recovered from inline assistant JSON after the downloadable artifact was missing.
- Psyllium discovery is harvested for 8/9 shards with non-empty source-candidate artifacts. `08-discovery-mechanism-viscosity-bile-acid` remains blocked: the original thread produced no artifact and alternate-lane harvest failed to load the ChatGPT thread content after retries.
- Both `10-snowball-gap-fill` seams were sent and harvested. Psyllium explicitly backfilled the failed mechanism/viscosity/bile-acid gap and returned 36 addition records in an `Additions` JSON block; red yeast rice returned `SOURCE_CANDIDATES_V1`, corrections, diagnosis, and variant split notes.
- Source-ledger reducers were materialized with explicit snowball inputs and harvested successfully for both workspaces.
- Psyllium reducer validated with 216 canonical source records across 9 extraction batches; no batch exceeds 40 records.
- Red yeast rice reducer validated with 283 canonical source records across 13 extraction batches; no batch exceeds 40 records.
- Source-extraction prompts and command wrappers were materialized for all reducer batches, sent with a 60-second stagger, and harvested successfully.
- Psyllium extraction is complete for 9/9 batches. Each batch produced a downloaded ZIP containing source-page material plus findings, appraisal/evidence, and artifact/manifest files.
- Red yeast rice extraction is complete for 13/13 batches. Each batch produced a downloaded ZIP containing source-page material plus findings, appraisal/evidence, and artifact/manifest files.
- Section-synthesis prompts and command wrappers were materialized for all planned sections: psyllium 9/9 and red yeast rice 10/10.
- Section-synthesis sends are complete for all 19 seams. Recorded send distribution is psyllium `hercules=3`, `eragon=2`, `vonneumann=2`, `mountain=2`; red yeast rice `eragon=4`, `vonneumann=2`, `mountain=2`, `hercules=2`.
- Section-synthesis harvest is complete for all 19 seams.
- Harvest lane handling: the first dynamic queue correctly stopped on a missing `--explore-lane` guardrail; a later eragon exploratory harvest for psyllium `24-section-synthesis-safety-and-stop-conditions` failed to load the thread, so remaining work was rebalanced onto recorded send lanes. Recorded-lane queues completed safely on `hercules`, `mountain`, and `vonneumann`.
- Page-builder packages were completed and validated for both workspaces.
- QA sends and harvests are complete for both workspaces. Psyllium evidence QA and safety QA both returned blocker verdicts, and red yeast rice evidence QA and safety QA both returned blocker verdicts.
- Final landing reducers completed successfully on recorded lanes: psyllium on `phlebas`, red yeast rice on `vonneumann`.
- The reducer download packages are present for both protocols, including final patches, file manifests, source ledgers, evidence-appraisal exports, research/artifact manifests, and verification outputs.
- The reducer patches do not cleanly apply to the current working tree because the target Health Commons files already exist as untracked content. Treat the current `packages/health-commons/content/**` files as the landing candidate rather than replaying the patches blindly.
- Final reducer manifests are no longer a path/hash-exact description of the current landing candidate after reconciliation: duplicate/shared lipid guideline source pages were canonicalized instead of kept under protocol-specific duplicate paths, and the red yeast rice ApoB page was merged into the existing `apolipoprotein-b` biomarker key. Validation is based on Health Commons generation/type/test checks plus direct inspection rather than manifest hash equality.
- Shared lipid biomarker pages and duplicate/shared guideline source pages are intentionally merged across the two cholesterol protocols and existing omega-3 source identities where applicable, rather than keeping protocol-specific duplicate versions from either single reducer package.
- The current landing candidate has passed Health Commons generation and R2 artifact dry-run validation after schema cleanup, duplicate-source/alias reconciliation, endpoint-key normalization, missing artifact-record backfill, and duplicate source identity canonicalization against existing omega-3 source pages.
- The psyllium protocol test-plan `safetyOutcomeKeys` were temporarily removed because the current catalog schema validates those keys against biomarker ids rather than the `safety_outcome:*` ids returned by the reducer; restore them later only after the Health Commons schema supports safety-outcome references there.
- Next step is to finish broad verification and required completion audits, then commit or hand off the scoped Health Commons content landing once unrelated dirty work can be safely excluded.

## Verification

- Direct readback of each workspace `workflow.json`, `prompts/01-charter.md`, and `state/chat-urls/01-charter.txt` when send succeeds.
- `git diff --check -- agent-docs/exec-plans/active/2026-04-26-psyllium-red-yeast-rice-research.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- Setup/send verification completed:
  - both `workflow.json` files parse as `charter_pending`
  - both seam state files show `send=completed`
  - both `state/chat-urls/01-charter.txt` files are present
  - both prompts include cholesterol-specific scope guardrails
  - privacy scan over the two new research workspaces plus this plan passed
  - `git diff --check -- agent-docs/exec-plans/active/2026-04-26-psyllium-red-yeast-rice-research.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md` passed
  - `pnpm typecheck` passed
  - `pnpm test:smoke` passed
- Discovery validation after harvest:
  - psyllium: 8/9 discovery artifacts parse with non-empty records; missing `08-discovery-mechanism-viscosity-bile-acid` is documented as a browser/thread export blocker.
  - red yeast rice: 10/10 discovery artifacts parse with non-empty records.
- Snowball validation after harvest:
  - psyllium response contains `Additions`, `Corrections`, `Missing-source diagnosis`, and `Variant split notes`; additions are JSON with 36 records but not labeled literal `SOURCE_CANDIDATES_V1`.
  - red yeast rice response contains `SOURCE_CANDIDATES_V1`, `Additions`, `Corrections`, `Missing-source diagnosis`, and `Variant split notes`.
- Source-ledger reducer validation after harvest:
  - psyllium `canonical_source_ledger_v1.json` and `source_extraction_batches_v1.json` parse; 216 records, 9 batches, no oversized batches.
  - red yeast rice `canonical_source_ledger_v1.json` and `source_extraction_batches_v1.json` parse; 283 records, 13 batches, no oversized batches.
- Source-extraction validation after harvest:
  - all psyllium and red yeast rice extraction seams show `harvest.status=completed`.
  - all 22 extraction batches have downloaded ZIP packages.
  - ZIP-entry validation found source-page material plus findings, appraisal/evidence, and artifact/manifest files for every batch.
- Section-synthesis send validation:
  - psyllium: 9/9 section-synthesis seams show `send.status=completed` with saved chat URLs.
  - red yeast rice: 10/10 section-synthesis seams show `send.status=completed` with saved chat URLs.
- Section-synthesis harvest validation:
  - psyllium: 9/9 section-synthesis seams show `harvest.status=completed`; all 9 response files contain a section bottom line, research landscape groups, and claim blocks.
  - red yeast rice: 10/10 section-synthesis seams show `harvest.status=completed`; all 10 response files contain a section bottom line, research landscape groups, and claim blocks.
- Page-builder and QA validation:
  - page-builder packages completed for both psyllium and red yeast rice.
  - psyllium evidence QA and safety QA completed with blocker verdicts.
  - red yeast rice evidence QA and safety QA completed with blocker verdicts.
  - final reducer sends were launched and harvested on recorded lanes only: red yeast rice on `vonneumann`, psyllium on `phlebas`.
  - final reducer outputs contain downloadable package artifacts for both protocols.
  - repo workflow tooling verification while guarding wrong-browser harvests: `pnpm test:diff scripts/research-run.mjs scripts/research-init.test.ts`, `pnpm typecheck`, `pnpm test:smoke`, `node --check scripts/research-run.mjs`, and `git diff --check -- scripts/research-run.mjs scripts/research-init.test.ts .agents/skills/health-commons-research/SKILL.md agent-docs/exec-plans/active/2026-04-26-psyllium-red-yeast-rice-research.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md` passed.
- Final package inspection:
  - psyllium final reducer status is `succeeded` with eight downloaded artifacts.
  - red yeast rice final reducer status is `succeeded` with nine downloaded artifacts.
  - `git apply --check` is blocked by already-present target files, so patches were not replayed.
  - final manifest coverage is not path/hash exact because shared guideline sources and the ApoB biomarker were canonicalized into existing/current Health Commons identities rather than duplicated under every reducer-proposed path.
  - current content requires Health Commons validation rather than byte-for-byte final-manifest equality because the working tree contains merged shared biomarker/source pages and pre-materialized untracked content.
- Landing validation:
  - `pnpm --filter @murphai/health-commons generate` passed.
  - `pnpm --filter @murphai/health-commons generate:check` passed.
  - `pnpm --filter @murphai/health-commons typecheck` passed.
  - `pnpm --filter @murphai/health-commons test` passed.
  - `pnpm --filter @murphai/health-commons artifacts:r2:dry-run` passed with expected non-redistributable artifact blocks.
  - duplicate content-key sanity check passed with no duplicate keys.
  - `git diff --check -- packages/health-commons/content agent-docs/exec-plans/active/2026-04-26-psyllium-red-yeast-rice-research.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md` passed.
  - `pnpm test:smoke` passed.
  - Privacy scan over the new psyllium/red yeast rice content paths and active plan passed.
  - `pnpm typecheck` is blocked by unrelated active Cloudflare work: `apps/cloudflare/test/runtime-bridge-checkpoint.test.ts` has tuple/possibly-undefined errors.
- Completion audits:
  - `security-privacy-review` completed and found one low-risk red yeast rice product-recommendation phrasing issue; product-recommendation wording was replaced with product-evaluation/logging language and Health Commons generation was rerun.
  - `task-finish-review` completed and found two content issues: red yeast rice LDL endpoint keys pointed at `biomarker:ldl-cholesterol` instead of the protocol's `biomarker:ldl-c`, and the red yeast rice family self-referenced its own `parentFamilyKey`; both were fixed.
  - Post-audit reruns passed: `pnpm --filter @murphai/health-commons generate`, `pnpm --filter @murphai/health-commons generate:check`, `pnpm --filter @murphai/health-commons artifacts:r2:dry-run`, and scoped `git diff --check`.
