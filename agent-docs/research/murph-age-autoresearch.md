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

ARIC/MESA remain inactive. R119/R120/R121 created and validated the local admin docket, evidence-intake rules, and source-activation precheck, but the current evidence state is still `not_ready_missing_admin_evidence`. Until non-identifying source-access/admin evidence exists, the workflow must not activate sources, inspect dictionaries/codebooks, parse rows, score external validation, mutate the model, continue same-benchmark tuning, or make product claims.

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

Until those labels are present and R120/R121 pass, do not download source packages, inspect dictionaries or codebooks, parse rows, send source material to ReviewGPT, score external validation, or use the result for product copy.

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
