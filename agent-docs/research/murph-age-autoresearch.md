# Murph Age Autoresearch

Last verified: 2026-05-09

## Purpose

This doc is the durable operating rulebook for Murph Age research/autoresearch work.

Murph Age is a research effort toward a calibrated, interpretable health-age signal. The internal research loop should optimize for outcome prediction, generalization, uncertainty, and user-comprehensible attribution. It must not collapse chronological-age mimicry, health prognosis, and intervention actionability into one unchecked score.

## Current State Snapshot

Murph Age has a research-only NHANES Bench-0 anchor, not a product model.

Current aggregate benchmark state:

- data source: public NHANES Bench-0 clinical/lab benchmark only
- endpoint: locked 10-year all-cause mortality outcome
- split: 4,664 train / 1,531 calibration / 1,562 test rows
- total benchmark rows: 7,757
- total events: 1,603
- external validation: not yet executed
- product promotion: not authorized

Current aggregate model state:

- `age_sex_reference_logistic`: baseline reference, test AUC about 0.745, test Brier about 0.120
- `clinical_core_noncrp_l2_0p05_intercept_slope_calibration_missingness_indicators_anchor`: current research anchor, test AUC about 0.818, test Brier about 0.103
- `cand_r60_l2_0p02_intercept_slope_current_indicators_hypothesis`: tiny same-family improvement, test AUC about 0.819, test Brier about 0.103
- `cand_r60_missingness_simplification_l2_0p05_no_indicators_sensitivity`: simpler sensitivity model, test AUC about 0.817, test Brier about 0.103

The current anchor is the calibrated regularized non-CRP clinical-core model. It is useful as a research anchor, but it must not become a user-facing Murph Age score until external validation, uncertainty, attribution, and product-claim gates are separately satisfied.

## Current Blocker

The next meaningful scientific step is external validation, not more NHANES-only tuning.

ReviewGPT R99 froze the NHANES candidate-lock stage and recommended external-validation/source planning. ReviewGPT R118 then selected ARIC/MESA admin/access work as the next strategic lane by 3/3 consensus.

ARIC/MESA remain inactive. R119/R120/R121 created and validated the local admin docket, evidence-intake rules, and source-activation precheck. R122 added the BioLINCC request action brief, R123 added a reusable label-only evidence-intake template and validator, R124 added a fail-closed source-activation packet builder, and R125 proved only a synthetic ready-path check. R126 then asked ReviewGPT the post-blocker strategic lane question; 2 of 3 reviewers chose `prioritize_aric_mesa_admin`, with the third allowing proposal-only ideation while keeping ARIC/MESA admin primary. R127 materialized that result into a local admin-status ledger and blocker register. R128 added a label-only admin-attempt tracker so a future human/admin attempt can be documented without identifiers or source material. R129 added synthetic fixture coverage for that tracker, with passing label-only examples and fail-closed malformed/unlocking examples. R130 reconciled the proposal inventory: only the two R84/R86 transport/evaluator proposals remain current proposal-only authorities, while older R13/R72/R81 proposal artifacts are historical, inactive, or discarded. R131 added the exact future command bridge from filled R128 attempt, to filled R123 evidence intake, to R124 source-activation precheck, with ReviewGPT reserved for a real metadata-only source-activation transition. R132 added a single human/admin handoff index across those files and commands. R133 added the current abstract external-validation adapter boundary for the future source-activation path. The real evidence state is still `not_ready_missing_admin_evidence`; R124 remains `blocked_no_ready_admin_evidence_no_prompt_emitted`.

R125 is not access evidence. It is only a synthetic proof that the future packet shape works in principle once real non-identifying admin/access labels exist. Until that real evidence exists, the workflow must not activate sources, inspect dictionaries/codebooks, parse rows, score external validation, mutate the model, continue same-benchmark tuning, or make product claims.

## Admin Handoff For External Validation

This is the next human/admin lane. Keep it outside ReviewGPT until there is real source-access evidence to review.

Official starting points:

- ARIC BioLINCC study page: `https://biolincc.nhlbi.nih.gov/studies/aric/`
- MESA BioLINCC study page: `https://biolincc.nhlbi.nih.gov/studies/mesa/`
- BioLINCC FAQ: `https://biolincc.nhlbi.nih.gov/faq/`
- BioLINCC User Guide: `https://biolincc.nhlbi.nih.gov/media/BioLINCC_User_Guide_05Jan2026.pdf`

Source priority:

- ARIC is the primary true-external candidate, but its BioLINCC page lists commercial-use data restrictions and says the data cannot be used for commercial purposes.
- MESA is the alternate true-external candidate, with commercial-use restrictions listed as tiered.
- Neither source may be treated as executable until the source-specific terms are reviewed by the appropriate human/institutional owner and mapped into the R120 evidence labels.

Minimum non-identifying evidence needed before source activation review:

- selected source target
- external institutional request owner exists
- research-use scope permits external validation research
- IRB/ethics status is approved, exempt, or otherwise formally not required
- data-use agreement or release status is approved/executed, or formally not required
- permitted material classes include local-row access and aggregate outputs
- aggregate-output policy allows aggregate metrics with suppression
- commercial/product-use status is compatible with the intended Murph research boundary
- retention/storage boundary approves ignored local cache and deletion controls
- source-governance reviewer says the package is ready for activation review

Local handoff artifacts:

- R122 action brief: `output-packages/research/murph-age/autoresearch/admin-handoff/biolincc-request-action-brief-r122.md`
- R123 evidence intake template: `output-packages/research/murph-age/autoresearch/admin-handoff/aric-mesa-evidence-intake-form-r123.template.json`
- R123 runner notes: `output-packages/research/murph-age/autoresearch/admin-handoff/aric-mesa-evidence-intake-runner-r123.md`
- R124 blocked source-activation receipt: `output-packages/research/murph-age/autoresearch/admin-handoff/aric-mesa-source-activation-blocked-r124.md`
- R125 synthetic ready-path check: `output-packages/research/murph-age/autoresearch/admin-handoff/synthetic-ready-activation-path-check-r125.md`
- R126 strategic lane summary: `output-packages/research/murph-age/autoresearch/reviewgpt/reduced/r126-post-blocker-research-lane-summary.json`
- R127 admin status ledger: `output-packages/research/murph-age/autoresearch/admin-handoff/aric-mesa-admin-status-ledger-r127.json`
- R127 access blocker register: `output-packages/research/murph-age/autoresearch/admin-handoff/aric-mesa-access-blocker-register-r127.md`
- R128 admin attempt tracker: `output-packages/research/murph-age/autoresearch/admin-handoff/aric-mesa-admin-attempt-tracker-r128.md`
- R128 admin attempt template: `output-packages/research/murph-age/autoresearch/admin-handoff/aric-mesa-admin-attempt-status-r128.template.json`
- R129 admin attempt fixture suite: `output-packages/research/murph-age/autoresearch/admin-handoff/aric-mesa-admin-attempt-fixtures-r129.md`
- R130 proposal-state reconciliation: `output-packages/research/murph-age/autoresearch/loop/contracts/proposal-state-reconciliation-r130.v0.json`
- R131 activation command bridge: `output-packages/research/murph-age/autoresearch/admin-handoff/aric-mesa-activation-command-bridge-r131.md`
- R132 human/admin handoff index: `output-packages/research/murph-age/autoresearch/admin-handoff/aric-mesa-human-admin-handoff-index-r132.md`
- R133 current external-validation adapter contract: `output-packages/research/murph-age/autoresearch/loop/contracts/current-external-validation-adapter-contract-r133.v0.json`
- R134 safe local download intake guide: `output-packages/research/murph-age/autoresearch/admin-handoff/aric-mesa-safe-local-download-intake-r134.md`
- R135 simple access intake bridge: `output-packages/research/murph-age/autoresearch/admin-handoff/aric-mesa-simple-access-intake-r135.md`
- R136 controlled-source landing-zone receipt: `output-packages/research/murph-age/autoresearch/admin-handoff/controlled-source-landing-zone-receipt-r136.md`
- R137 source-activation ReviewGPT queue builder: `output-packages/research/murph-age/autoresearch/reviewgpt/r137-aric-mesa-source-activation-review-draft-summary.md`
- R138 next-action status readout: `output-packages/research/murph-age/autoresearch/admin-handoff/aric-mesa-next-action-status-r138.md`
- R139 frozen external adapter input schema: `output-packages/research/murph-age/autoresearch/loop/contracts/frozen-external-adapter-input-schema-r139.v0.json`
- R139 adapter schema reviewer packet: `output-packages/research/murph-age/autoresearch/reviewer-packets/frozen-external-adapter-input-schema-r139.reviewer.md`
- R140 post-download preflight runner: `output-packages/research/murph-age/autoresearch/admin-handoff/aric-mesa-post-download-preflight-r140.md`
- R141 external-validation aggregate readout contract: `output-packages/research/murph-age/autoresearch/admin-handoff/external-validation-aggregate-readout-contract-r141.md`

If a human/admin owner can legally download ARIC/MESA materials under the relevant source terms, that can unblock the external-validation lane, but it does not by itself authorize Codex to inspect the files. Stage any controlled files only in an ignored local cache such as `.runtime/murph-age/controlled-sources/`, never in repo-tracked paths, `output-packages/`, chat, ReviewGPT packets, logs, or embeddings.

R135 is the practical short-form bridge for access facts. It accepts checkbox-style fields such as source, download access, local analysis, aggregate metrics, product boundary, cache boundary, and reviewer readiness, then maps them into the existing R128/R123 label-only templates. R136 can check whether the ignored runtime landing zones contain entries without reporting file names, sizes, hashes, paths, or contents. R137 is fail-closed and creates ReviewGPT source-activation prompts only after R124 has prepared a metadata-only packet from ready real labels. R138 is the one-command no-content status readout for the current ARIC/MESA next safe action. R139 freezes the source-agnostic adapter input schema for the current NHANES Bench-0 anchor so future external-validation work has a stable target before any source-specific mapping begins. R140 runs the safe post-download readiness chain after files are staged, while still refusing source inspection, row parsing, scoring, ReviewGPT sending, model mutation, and claims. R141 consolidates the aggregate-only future readout boundary and keeps execution blocked until source activation, access labels, threshold predeclaration, and a later execution-release gate are all satisfied.

R143 reopened the external-validation source strategy question after BioLINCC access friction appeared higher than expected: BioLINCC requires institutional identity and a qualified permanent institutional requester, while ARIC/MESA also carry commercial-use restrictions. Three GPT-5.5 Extended Pro ReviewGPT lanes were sent to decide whether to continue ARIC/MESA through an institutional/collaborator path, parallelize with a lower-friction dataset, pivot to another primary external-validation source, or build a source inventory first. The original R143 lanes produced long narrative drafts without the required structured marker, so a compact JSON-only retry was sent and reduced cleanly. The reduced R143 retry consensus was 3/3 `parallel_biolincc_and_alternative`.

R143's practical result: keep BioLINCC alive as a high-value but institution-gated parallel lane, with MESA generally favored over ARIC for the commercial/research-rights path; do not let ARIC/MESA block all external-validation progress. Build a metadata-only source-priority inventory and source-rights queue next. ReviewGPT repeatedly highlighted UK Biobank and All of Us as alternative-source candidates to investigate, NHANES III public linked mortality as a low-friction same-family sanity/stress lane rather than decisive true external validation, and CHS/CARDIA/Framingham/REGARDS/Health ABC/MrOS/HRS/WHI as secondary or rights-gated candidates requiring careful public-metadata checks. R143 is strategy-only. It does not authorize source login, source requests, agreement/codebook/dictionary inspection, row parsing, scoring, model mutation, or claims.

R144 materialized the R143 next step as a metadata-only local source-priority inventory and source-rights queue. The validator passed with 13 candidate sources: UK Biobank as the primary alternative true-external candidate; All of Us as a parallel candidate gated by current DURA/institution eligibility and endpoint feasibility; NHANES III public linked mortality as a low-friction same-family sanity lane; MESA as the BioLINCC parallel lead if an institutional requester/RMDA path exists; and ARIC/CHS/CARDIA/Framingham/WHI/REGARDS/Health ABC/MrOS/HRS as secondary, investigate, or hold lanes depending on rights and demographic fit. R144 remains metadata-only and does not authorize source login, source requests, agreement/codebook/dictionary inspection, row parsing, scoring, model mutation, or claims.

R145 turned that inventory into a concrete metadata-only action playbook. The current source order is: pursue UK Biobank first; check All of Us in parallel; prepare NHANES III public linked mortality only as a same-family sanity lane after a future public-source execution gate; keep MESA as the BioLINCC lead if an institutional requester/RMDA path appears; hold ARIC for product-adjacent work unless a deliberate noncommercial validation boundary is separately approved. R145 requires only non-identifying access-feasibility labels before any future source-activation review and still authorizes no source login, requests, agreement/codebook/dictionary inspection, row parsing, scoring, model mutation, or claims.

R146 added the label-only intake template for those next source-feasibility facts. It covers UK Biobank, All of Us, NHANES III public linked mortality, and MESA only. All entries default to blocked and unknown. Future filled copies must contain labels only: requester/institution class, eligible researcher status, product-adjacent research status, public-interest/research purpose status, platform/agreement status, IRB/ethics status, analysis environment, AI/LLM/cloud/agent policy, mortality endpoint availability, baseline feature fit, aggregate export policy, small-cell threshold, local cache/deletion policy, and human governance readiness. Filled copies must not include names, emails, institution names, account ids, file names, source/agreement/codebook/dictionary text, row values, counts, metrics, model outputs, or claims.

R147 asked three GPT-5.5 Extended Pro ReviewGPT lanes whether the current BioLINCC institutional-access rule changes the source strategy. The reduced consensus was 3/3 `run_dual_nhanes_alt_admin`: BioLINCC/MESA should be downgraded from active technical blocker to parallel human-admin/collaborator lane; UK Biobank is the primary true-external feasibility target; All of Us is the parallel alternative-source feasibility target; and NHANES III public linked mortality may be prepared only as a bounded same-family sanity/stress lane. NHANES III can help test public-source execution discipline and historical transport, but it is not decisive true external validation and must not be used for product claims, benchmark mutation, source download, row parsing, scoring, or model mutation without later explicit gates.

R148/R149 materialized that decision into a local source-and-sanity next plan. The R148 matrix keeps UK Biobank and All of Us at label-only feasibility depth: access path, requester/institution requirements, public-interest fit, endpoint feasibility, frozen-feature fit, platform/export constraints, small-cell rules, cache/deletion rules, and AI/agent policy. The R149 NHANES III packet is only a public-source execution-gate shell. It records the reason a same-source NHANES split is not enough: the current NHANES Bench-0 train/calibration/test split is useful internal validation, but it cannot prove transport across another cohort, measurement pipeline, lab era, missingness pattern, access regime, or population mix. R148/R149 still authorizes no source login, source download, source document/codebook/dictionary storage, row hydration, external scoring, model mutation, or claims.

R150 filled the alternative-source labels using official public metadata only. UK Biobank remains the strongest near-term true-external feasibility candidate because its public metadata supports eligible organization/researcher access, health-related public-interest research, restricted-platform access, mortality linkage, and relevant baseline measurement/biomarker families, though exact fields, aggregate export, small-cell, cache, and AI/agent policies still need human review. All of Us remains viable but more constrained: it requires institutional DURA/tier access, individual-level analysis inside Researcher Workbench, has death data, and has rich EHR/physical/wearable data, but Registered Tier death-date/cause constraints, Workbench egress, endpoint construction, and exact feature coverage need human review. NHANES III public linked mortality remains the fastest public sanity lane only. R150 recommends a single R151 ReviewGPT decision packet: open minimal NHANES III public crosswalk now, prioritize UKB human access labels, prioritize All of Us access labels, run NHANES crosswalk and UKB labels in parallel, hold, or block.

R151 asked three GPT-5.5 Extended Pro ReviewGPT lanes whether to open NHANES III public documentation crosswalk work or prioritize alternative-source human access labels. The reduced consensus was 3/3 `run_parallel_nhanes_crosswalk_and_ukb_labels`: open a minimal NHANES III public linked-mortality documentation crosswalk as a same-family sanity-only lane, while building the UK Biobank human/admin access-label packet as the primary true-external feasibility lane. All of Us remains a secondary alternative label packet. The NHANES III crosswalk may store only labels, field ids/names, official URLs, retrieval hashes, and brief non-quoting summaries. It must not store source bodies, abstracts, tables, data-dictionary prose, codebook prose, PDFs, row values, participant ids, predictions, coefficients, model parameters, small cells, controlled rows, or embeddings. R151 still authorizes no source login, request submission, download, row hydration, endpoint extraction, external scoring, benchmark mutation, model mutation, or claims.

R152 executed the R151-approved local work. It created a NHANES III public-LMF label crosswalk stub with field ids/names only for the public mortality linkage surface: `SEQN`, `ELIGSTAT`, `MORTSTAT`, `PERMTH_EXM`, `PERMTH_INT`, `UCOD_LEADING`, `DIABETES`, and `HYPERTEN`. `PERMTH_EXM` is the candidate MEC-baseline follow-up field for a future endpoint contract, while `PERMTH_INT` is a candidate sensitivity field; no endpoint extraction is authorized. It also created the UK Biobank human/admin access-label packet covering organization/researcher eligibility, research-only scope, exact frozen-feature coverage, mortality endpoint construction, aggregate export, small-cell policy, platform/cache boundary, and AI/agent policy. R152 authorizes no source activation, source download, row hydration, endpoint extraction, scoring, model mutation, or claims.

R153 merged the R115/R116 feature-token inventory with the R152 mortality-field labels into a NHANES III feature-readiness map. All 18 frozen features have candidate NHANES III variable-name tokens, but only `age_years` and `sex_stratum` are exact candidates. Five features require unit harmonization labels: systolic blood pressure, diastolic blood pressure, BMI, waist circumference, and albumin. Eleven features require assay/cycle review labels: creatinine, glucose, HbA1c, total cholesterol, HDL, triglycerides, white blood cell count, lymphocyte percent, hemoglobin, RDW, and alkaline phosphatase. R153 proposes R154 as a public-doc feature-label crosswalk only; it still authorizes no source download, row hydration, endpoint extraction, scoring, model mutation, or claims.

R154 filled the NHANES III public-doc feature-label crosswalk at label level only. All 18 candidate variables now have field labels, and 15 have usable unit labels. Remaining blockers are age unit/adult-denominator confirmation, blood-pressure K1/K5 unit/interpretation, WBC unit confirmation, lab assay/cycle comparability, fasting or sampling-condition implications for glucose and triglycerides, NHANES III survey-weight/MEC/fasting/missingness policy, and the 10-year endpoint contract from the R152 mortality fields. R154 proposes R155 as the next reviewer packet to decide whether these labels are enough to build a no-score adapter-read preflight, or whether more public documentation labels are required. It still authorizes no source download, row hydration, endpoint extraction, scoring, model mutation, or claims.

R155 asked three GPT-5.5 Extended Pro ReviewGPT lanes whether R152/R154 are enough to open a no-score NHANES III adapter preflight scaffold. The reduced consensus was 3/3 `open_no_score_adapter_preflight_scaffold`. The allowed work is local manifest, contract, validator, unresolved-blocker, denied-effect, and reviewer-packet scaffolding only. R155 explicitly keeps source login, request submission, source download, public-use data download, source body storage, codebook/dictionary prose storage, row parsing, row hydration, endpoint extraction, denominator construction, metric computation, external-validation scoring, benchmark mutation, model mutation, product claims, recommendations, protocol claims, and embeddings blocked.

R156 built the R155-approved no-score NHANES III adapter-preflight scaffold. The validator passed with 18 feature-manifest rows, 8 mortality-manifest rows, 21 denied effects, 9 active blockers, no-score mode enabled, and an empty non-source fixture. The scaffold includes a manifest, no-score adapter contract, denied-effects policy, unresolved-blocker register, validator result, and reviewer packet. It validates only local metadata shape, label coverage, unresolved blockers, denied-effect policy, and storage/authorization attestations. It still authorizes no source download, row hydration, endpoint extraction, scoring, model mutation, or claims.

R157 added synthetic denied-effect fixtures for the no-score preflight scaffold. The validator passed with 13 expected-deny fixtures covering source download, source body storage, row payloads, participant identifiers, endpoint vectors, denominator rows, metrics/scoring, predictions, split memberships, benchmark mutation, model mutation, claims, and embeddings. The fixture set contains no source rows or source bodies and still authorizes no source download, row hydration, endpoint extraction, scoring, model mutation, or claims.

R158 asked three GPT-5.5 Extended Pro ReviewGPT lanes what the next NHANES III boundary should be after the R156/R157 no-score scaffold. The reduced consensus was 3/3 `build_endpoint_denominator_policy_scaffold`. ReviewGPT explicitly rejected jumping straight to a row-cache or scoring execution gate. The next local work was allowed only as endpoint/denominator policy scaffolding: primary 10-year all-cause endpoint shape, MEC-baseline denominator shape, unit/comparability blockers, fasting/survey/missingness blockers, denied-effect fixtures, and a reviewer packet. R158 still authorizes no source login, request submission, source download, source body storage, codebook/dictionary storage, row parsing, row hydration, endpoint extraction, denominator construction, metric computation, external-validation scoring, benchmark mutation, model mutation, claims, or embeddings.

R160 executed the R158-approved local scaffold. The validator passed with 21 denied effects, 21 denied fixtures, 9 active blockers, and 6 feature-policy blocker groups. The primary endpoint remains a policy-only candidate for 10-year all-cause mortality from MEC baseline, and the target denominator remains a policy-only adult 40-79 public-LMF-eligible MEC-baseline candidate. Both endpoint execution and denominator construction are explicitly unauthorized. NHANES III remains a same-family historical sanity lane, not true external validation.

R159 asked three GPT-5.5 Extended Pro ReviewGPT lanes the direct validation-strategy question: why not simply split NHANES, whether NHANES-only validation is enough, and what better datasets or workarounds should be pursued while BioLINCC is institution-gated. The reduced consensus was 3/3 `parallel_nhanes_sanity_and_true_external_source_hunt`. The simple answer is now: NHANES split validation is necessary internal overfit control, but it is not true external validation. It can show that the locked recipe predicts held-out NHANES participants, but it cannot prove transport to a different cohort, country, recruitment process, measurement system, calendar era, lab pipeline, missingness regime, or mortality-linkage regime. The practical validation stack is current NHANES Bench-0 for internal overfit control, NHANES III public linked mortality for same-family historical sanity, UK Biobank and All of Us as primary true-external feasibility lanes, and MESA/BioLINCC as a valuable but nonblocking human-admin lane.

R161 materialized the R159 consensus as a local validation strategy snapshot. The validator passed with 5 validation-stack lanes, 8 source-priority entries, and 7 overfit controls. The active controls are to freeze the current NHANES Bench-0 split, avoid resplitting to chase scores, prefer train/calibration work before public-test reads, label every result as internal/same-family/true-external, prohibit NHANES-only product claims, require external validation before promotion, and keep controlled-source execution blind until source-specific gates approve more.

R162 created a true-external source feasibility handoff for UK Biobank and All of Us, reconciling the older R146/R150/R152 source artifacts with the R159/R161 priority update. The validator passed with 2 target sources, 15 required label fields, all entries blocked, and no authorization for source activation, source requests, source login, downloads, agreement/codebook/dictionary inspection, row hydration, endpoint extraction, denominator construction, external scoring, model mutation, benchmark mutation, claims, or embeddings. The packet is ready for human/admin label filling only; it is not evidence of access and does not unlock external validation.

Until R135/R123/R124 pass against real evidence and a later source-specific activation gate approves more, Codex must not inspect source packages, dictionaries, codebooks, forms, agreement text, row files, counts, or metrics. Do not send source material to ReviewGPT, score external validation, or use the result for product copy.

## Operating Rule: ReviewGPT Is Not A Permission Clerk

ReviewGPT is a senior scientific reviewer and idea generator, not a mandatory approval stop for every local step. Use it for big architecture questions, research-direction choices, new-lane ideation, aggregate result critique, and meaningful transitions. Do not stop the workflow to ask whether Codex may perform a simple handoff checklist, file readback, queue cleanup, validator rerun, or other local implementation chore that follows an already-decided rule.

Use ReviewGPT for high-leverage judgment:

- generating or ranking research directions
- critiquing aggregate model results
- reviewing major model, evaluator, feature, benchmark, or source-strategy changes
- reviewing external-validation execution gates
- reviewing source activation, model promotion, or product-facing claim boundaries
- poking holes in scientific reasoning, overfitting risk, leakage risk, and generalization claims

Do not use ReviewGPT to bless obvious local chores:

- handoff checklists
- metadata-only contract cleanup
- bounded metadata seed plans
- local runner scaffolding
- queue hygiene
- tab harvesting and stale-tab cleanup
- reducer enum repairs for harmless label drift
- ignored-artifact packaging
- validator readbacks when the rule is already clear
- continuity-ledger updates

For local grunt work, Codex should act directly, keep artifacts narrow, run local validators/readbacks, and record the result. ReviewGPT should re-enter when the next choice is genuinely scientific or strategic: what lane to pursue, whether a result is meaningful, whether an execution/promotion/source boundary should move, or what research idea should be tried next.

## Role Split

Codex owns local execution discipline:

- build scripts, validators, manifests, and reviewer packets
- enforce source-rights and privacy guardrails
- keep row values, source bodies, dictionaries, model internals, and private identifiers out of repo artifacts and ReviewGPT packets
- close harvested tabs and avoid duplicate ReviewGPT lanes
- maintain continuity state
- refuse duplicate or overfit-prone loops when prior gates already blocked them

ReviewGPT owns senior scientific critique:

- decide or challenge major research branches
- suggest candidate model/evaluator improvements
- identify missing evidence, leakage, overfitting, and construct-collapse risks
- review aggregate-only results before the loop spends more benchmark budget
- review external-validation or promotion transitions before any source or product boundary changes

## Transition Gates

Use larger transition gates instead of micro-gates.

Preferred gate levels:

- **Direction Gate:** what research/model/source path is worth trying next?
- **Execution Gate:** may a bounded benchmark run execute?
- **Aggregate Results Gate:** what did the aggregate-only results show, and what should change next?
- **Source Activation Gate:** may a new external source move beyond metadata/admin status?
- **Promotion Gate:** is anything strong enough to move toward product-facing behavior?

Avoid asking ReviewGPT for a new gate when the next step is a direct implementation of an already-approved local artifact.

## Model Loop Policy

Autoresearch should be proposal-first.

The loop may propose changes to:

- feature sets
- transforms
- missingness policy
- calibration/evaluator behavior
- model family constraints
- source-priority strategy
- uncertainty and attribution reporting

The loop must not silently mutate:

- locked benchmark definitions
- endpoint definitions
- public-test state
- source activation state
- model promotion state
- product, recommendation, or protocol claims

The loop should avoid repeated NHANES-only tuning unless the proposal is genuinely new and has a clear generalization rationale.

## Source And Privacy Boundary

Unless a future source-specific gate explicitly unlocks more, Murph Age research artifacts may contain only metadata, hashes, aggregate summaries, validator statuses, and non-quoting source-access notes.

They must not contain:

- source bodies, abstracts, table text, codebook prose, or data dictionaries
- row values, participant identifiers, split memberships, predictions, coefficients, calibration parameters, model parameters, or small cells
- controlled rows or controlled-source content
- embeddings of source or row content
- product claims, recommendation claims, protocol claims, or clinical validation claims

ARIC/MESA and similar controlled sources stay inactive until human/institutional access evidence and a later source-activation review exist.

## Current Practical Default

When unsure whether to ask ReviewGPT:

1. If the step changes scientific direction, benchmark execution, external validation, source activation, model promotion, or user-facing claims, ask ReviewGPT.
2. If the step merely implements or packages a previously decided local guardrail, contract, checklist, validator, or ledger update, Codex should do it locally.
3. If the step is local but could leak private data, controlled content, or model internals, add or run a fail-closed validator before proceeding.
