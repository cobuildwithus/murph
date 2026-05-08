# Murph Age Autoresearch

Last verified: 2026-05-08

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

If a human/admin owner can legally download ARIC/MESA materials under the relevant source terms, that can unblock the external-validation lane, but it does not by itself authorize Codex to inspect the files. Stage any controlled files only in an ignored local cache such as `.runtime/murph-age/controlled-sources/`, never in repo-tracked paths, `output-packages/`, chat, ReviewGPT packets, logs, or embeddings.

R135 is the practical short-form bridge for access facts. It accepts checkbox-style fields such as source, download access, local analysis, aggregate metrics, product boundary, cache boundary, and reviewer readiness, then maps them into the existing R128/R123 label-only templates. R136 can check whether the ignored runtime landing zones contain entries without reporting file names, sizes, hashes, paths, or contents. Until R135/R123/R124 pass against real evidence, Codex must not inspect source packages, dictionaries, codebooks, forms, agreement text, row files, counts, or metrics. Do not send source material to ReviewGPT, score external validation, or use the result for product copy.

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
