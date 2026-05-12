# Murph Age Autoresearch

Last verified: 2026-05-09

## Purpose

This doc is the durable operating rulebook for Murph Age research/autoresearch work.

Murph Age is a research effort toward a calibrated, interpretable health-age signal. The internal research loop should optimize for outcome prediction, generalization, uncertainty, and user-comprehensible attribution. It must not collapse chronological-age mimicry, health prognosis, and intervention actionability into one unchecked score.

## High-Level Goal

Build a living Murph Age research system that can eventually turn many kinds of user-consented health data into one calibrated, interpretable age-like signal.

The product-facing dream is simple: a person connects their labs, wearables, activity, device tests, and later Murph-native experiment data, then sees one top-level "how healthy am I?" age-like number with uncertainty, domain breakdowns, and feature-level reasons. The research target underneath that number is not chronological-age prediction. It is calibrated prediction of meaningful future outcomes, followed by a careful translation into an age-like display once the model has proven it generalizes.

## Plan At A Glance

The system has five layers:

- source layer: lawful public, free-registered, partner-run aggregate, and later Murph-native consented data sources
- benchmark layer: locked outcome tasks with fixed endpoints, splits, leakage rules, denominator rules, and aggregate-only reporting
- model loop: small proposal-only candidate batches trained and evaluated against locked benchmarks
- reviewer layer: ReviewGPT critiques major science, architecture, source strategy, model direction, and aggregate result interpretation
- product translation layer: later maps validated risk models into age-like UX, uncertainty, domain attribution, feature attribution, and recommendation boundaries

The immediate research philosophy is: simple, calibrated, interpretable models first; external generalization before product claims; no test-set chasing; no rights-bending data shortcuts.

## Current State Snapshot

Murph Age currently has research anchors only. Nothing is product-facing, clinical, protocol, recommendation, or promotion-ready.

Until a later product authorization review explicitly unlocks it, Murph Age must not appear on the website, in the dashboard sidebar, in dashboard cards, or as user-facing readiness/status copy. Local query projections and benchmark artifacts may support research plumbing, but product surfaces stay silent.

Current live research anchor:

- data source: official public NHIS linked-mortality lane
- endpoint: year-based 10-year all-cause mortality
- years: NHIS 1997-2009
- split: train 1997-2005, calibration 2006-2007, held-out test 2008-2009
- primary row count: 302,088, with 33,538 ten-year events
- held-out test count: 47,151, with 5,147 ten-year events
- model: `r399_compact_age_nonlinear_l2_0p000`
- model family: compact logistic regression using allowed NHIS proxy features, age squared, age-by-sex, and intercept-slope calibration
- held-out test metrics: weighted AUC 0.874688, unweighted AUC 0.877295, Brier 0.061991, log loss 0.216226, mean prediction error 0.000702, calibration slope 0.983047

R401 ReviewGPT consensus froze this NHIS anchor for diagnostics and explicitly rejected more L2-grid searching on the same split. R405 accepted the residual diagnostic brief and recommended using the frozen anchor residual map to choose the next locked benchmark or external public source lane, not to keep tuning the NHIS test split.

Important supporting anchors:

- NHANES Bench-0 remains a historical internal clinical/lab anchor, not the current live model.
- NHANES III public linked mortality passed an aggregate-only same-family historical sanity run; it is encouraging plumbing/signal evidence, not true external validation.
- ARIC/MESA/BioLINCC remain valuable but inactive human-admin or partner lanes because of institutional/requester and use-rights constraints.
- MIDUS/ICPSR, CRELES, CHARLS, HRS-family sources, UK Biobank, All of Us, PLCO/NACC, PhysioNet hospital stress lanes, and partner aggregate validation remain source-strategy candidates subject to lawful access and source-specific terms.

## Current Big Question

The next meaningful work is not "make NHIS AUC slightly higher." It is: what source, benchmark, or locked evaluation lane best tests whether the current approach generalizes?

Current next moves:

- keep NHIS anchor frozen except for aggregate diagnostics that generate future hypotheses
- run senior ReviewGPT review only for high-level source/benchmark/model-direction choices
- prioritize lawful next-source decisions from the R166/R168/R176/R180-R185 and R341/R362 source strategy lineages
- prefer a next locked benchmark or true-external/partner aggregate source lane over additional same-split NHIS tuning
- preserve NHANES/NHIS/NHANES III as internal or same-family evidence, not product validation

Canonical current direction: external generalization after the frozen NHIS anchor. Near-term candidates are CRELES/CHARLS terms and authorized-user feasibility, MIDUS/ICPSR terms and access labels, HRS-family source-rights labels, and partner aggregate validation. Do not tune the NHIS held-out test split further.

Torrents, leaks, unauthorized mirrors, credential sharing, and terms-violating controlled-data redistributions are not acceptable workarounds. They would invalidate source rights, benchmark provenance, and future product trust.

## Target Model Shape

The near-term model is an outcome model, not a hand-coded biological-age formula and not a chronological-age predictor.

Current preferred shape:

- train a small, interpretable risk model on locked outcome benchmarks
- calibrate it on held-out calibration data
- evaluate it once on held-out test data after selection
- compare it against simple age/sex and domain-specific references
- report aggregate discrimination, calibration, proper scores, missingness, subgroup stability, and residual diagnostics
- defer age-like display until the risk model is stable enough to map risk into an age-equivalent scale honestly

The model loop may propose feature transforms, simple interactions, missingness policy changes, calibration changes, evaluator diagnostics, source-priority changes, and eventually alternative model families. It must keep candidate batches small and hypothesis-driven. Complex model families, broad automated feature search, boosting, neural nets, stacking, and learned embeddings are deferred until simpler models and external validation show exactly why they are needed.

## Feature Registry And Attribution

The long-term feature registry can include anything a user can reasonably measure about their body or behavior:

- labs and biomarkers from services such as broad clinical blood panels
- wearable metrics such as resting heart rate, HRV, sleep, activity, and recovery proxies
- activity, exercise, step count, and fitness-test data
- body composition, blood pressure, and device measurements
- clinical history, symptoms, survey inputs, and medication/context flags
- later Murph-native protocol, intervention, and experiment data when consented and anonymized

The registry is broader than the executable model. A feature can be known, promising, or useful for future research without being allowed in the current benchmark. Each registry entry should track source, unit, collection method, missingness, leakage risk, domain grouping, evidence strength, executable status, and whether it supports attribution.

The eventual user experience should be able to answer:

- What is my top-level Murph Age-like estimate?
- How uncertain is it?
- Which domains are helping or hurting?
- Which specific measurements are moving the estimate?
- Which statements are prognostic only versus truly actionable?

Feature attribution is a first-class architecture requirement, but it is not yet a product claim. It should start as benchmark-side decomposition and only become user-facing after calibration, uncertainty, and external validation are strong enough.

## Product Translation Contract

Any future age-like number must be a post-validation display transform of calibrated outcome risk, tied to a named endpoint set, time horizon, reference population, and uncertainty interval. It must not be trained or tuned as chronological-age mimicry.

Before user-facing display, the translation layer needs:

- a declared risk-to-age reference curve
- monotonicity and calibration checks
- subgroup and missingness behavior checks
- source/data-quality uncertainty
- clear domain semantics
- abstention when uncertainty or data quality is too poor

Domain breakdowns are predictive evidence partitions, not independent organ ages unless separately validated. Feature explanations should use language like "associated with higher/lower predicted risk under this model," not causal or prescriptive language.

The current 10-year all-cause mortality anchor is tractable and useful, but it is not the whole health-age construct. Future Murph Age may need separately locked outcome heads for cardiovascular events, hospitalization, frailty, disability, functional decline, or disease-specific outcomes, plus a declared aggregation policy.

## Data And Validation Strategy

NHIS, NHANES Bench-0, and NHANES III are useful but not enough by themselves.

Use them as:

- internal and same-family benchmark discipline
- plumbing, endpoint, calibration, and evaluator validation
- hypothesis generation for future benchmarks
- checks that the loop can improve a model without leaking rows or chasing a public test split

Do not use them as:

- proof that Murph Age works generally
- product validation
- evidence of intervention actionability
- a reason to keep tuning the same held-out split

The validation stack should expand through lawful sources only:

- public or free-registered public-use sources when terms allow local research and aggregate outputs
- partner aggregate validation where a lawful data holder runs a frozen evaluator locally and returns only aggregate metrics
- organization/workbench or institutional sources only when the appropriate human/access owner has rights to use them
- future Murph-native anonymized, consented data as a living data layer, with source-specific privacy and governance controls

## Next Research Stages

Stage 1, current: freeze the NHIS research anchor and use R404/R405 diagnostics to choose the next locked benchmark or lawful external source lane.

Stage 2, next: pick one or two high-value generalization lanes. Preferred candidates are a lawful CRELES or CHARLS label-to-execution path if terms and authorized-user status allow it, an HRS-family metadata/source-rights intake, a MIDUS/ICPSR path if access labels are green, a partner aggregate validation contract, or another public locked benchmark with outcome labels. UK Biobank, All of Us, MESA, ARIC, and similar sources remain valuable but require human/admin or partner access rather than silent background work.

Stage 3: run the next benchmark or partner aggregate lane with predeclared endpoint, denominator, features, missingness policy, calibration policy, metric set, subgroup checks, and artifact boundary.

Stage 4: use aggregate results to decide whether the model needs a new feature family, calibration shape, domain structure, or source strategy. ReviewGPT should critique meaningful deltas and research direction here.

Stage 5, later: only after multiple external or transport-stress validations, start designing the age-equivalent display, domain ages, uncertainty, and feature attribution that could eventually become product-facing.

## Research Quality Bar

A model improvement is only meaningful if it clears the right bar for its stage.

For benchmark research:

- it must use predeclared features, endpoint, denominator, split, weighting, calibration, and metric rules
- it must beat an age/sex reference and the prior frozen anchor on the same denominator
- it must improve calibration and proper scores, not just AUC
- it must report missingness, abstention, subgroup calibration, and residual diagnostics
- it must keep row values, model internals, and source text inside the allowed local boundary
- it must freeze the whole evaluator package before execution: transforms, imputation, calibration layer, endpoint, denominator, metrics, subgroup bins, suppression thresholds, abstention policy, and reporting template

For generalization:

- it must work on a different time block, cohort, measurement pipeline, population, or partner aggregate lane
- it must not reuse the same public test split as an optimization target
- it must explain where performance degrades and whether that degradation is scientifically expected
- it may abstain when endpoint, denominator, censoring, feature mapping, missingness, or aggregate-export rules cannot be matched without material ambiguity
- it must predeclare a transport-stress matrix covering cohort era, geography, recruitment frame, age range, measurement pipeline, feature missingness, endpoint ascertainment, follow-up window, and denominator differences

For future product translation:

- it must have validated uncertainty
- it must have an age-equivalent mapping that does not hide risk calibration
- it must have domain and feature attribution that are stable enough to explain without overclaiming causality
- it must still separate prognosis from actionability and intervention effects

Poor external calibration, weak discrimination, abstention, or source incompatibility is a valid scientific result. Do not immediately mutate the benchmark, evaluator, or model to rescue a disappointing external result.

Before any future public, free-registered, controlled, or partner benchmark parses rows or receives aggregate results, create a benchmark card with endpoint, baseline, denominator, censoring rule, feature mapping policy, missingness policy, survey/weight policy when relevant, minimum cell threshold, allowed metrics, abstention criteria, evidence-class label, and allowed artifact boundary.

## Benchmark Exposure And Candidate Provenance

Every benchmark, split, diagnostic map, aggregate result, and reviewer-visible residual summary needs an exposure label:

- unused
- training-only
- calibration-selection
- public-test-inspected
- diagnostic-only
- same-family sanity
- true-external validation

Once a test or sanity lane has been inspected, it may generate broad hypotheses or source-priority decisions, but it must not create same-lane selection pressure on features, transforms, calibration, denominator rules, or candidate choice.

Every model-loop candidate batch must record its hypothesis source before execution:

- literature or mechanistic rationale
- train/calibration diagnostic
- external-source feasibility need
- robustness stress test
- already-inspected test or same-family residual

Candidates derived from inspected test or same-family residuals are barred from same-lane optimization. They may only become predeclared tests on a new locked benchmark or external source.

Keep a compact negative-result memory for failed candidates, abstentions, blocked source lanes, and reviewer rejections so the loop does not rediscover the same idea under a new name.

## Active Research Lanes

Use this table as the current source of truth. Historical R-artifact details are reference material, not mandatory process.

| Lane | Status | Allowed Depth | Next Action | Owner Type | Blocked Actions |
| --- | --- | --- | --- | --- | --- |
| Frozen NHIS anchor | Active research anchor | Aggregate diagnostics and future-hypothesis generation only | Use R404/R405 residual map to choose the next locked benchmark or lawful external source lane | Codex plus ReviewGPT for direction | More same-split NHIS tuning, product claims, promotion |
| NHANES Bench-0 | Historical internal anchor | Reference only | Keep for context, not as the live model | Codex | Treating as external validation or product evidence |
| NHANES III public linked mortality | Same-family historical sanity | Aggregate-only sanity evidence already run | Use as plumbing/signal context only | Codex | Tuning from NHANES III, promotion, true-external claims |
| CRELES / CHARLS | Near-term external transport candidates | Metadata labels and terms/access feasibility | Confirm source terms, authorized-user status, endpoint fit, and aggregate-output permission | User/human owner for access facts; Codex for metadata labels | Row download, codebook/body storage, scoring, or adapter execution before source activation |
| HRS-family sources | High-value older-adult external candidate | Metadata/source-rights intake | Build or fill label-only feasibility facts | User/human owner for access facts; Codex for metadata labels | Sensitive data access, row parsing, scoring, or source-content storage |
| MIDUS / ICPSR | Plausible non-NHANES biomarker-mortality candidate | Metadata labels only until user/account-holder terms acceptance and activation record | Keep as candidate; do not silently download | User/account holder for terms; Codex for metadata labels | Login, terms acceptance, row download, row join, feature crosswalk execution, scoring |
| Partner aggregate validation | Lawful workaround for inaccessible row-level data | Protocol and aggregate receipt schema | Prepare a frozen evaluator handoff only after partner authority and output policy are clear | Lawful data holder or partner | Receiving rows, identifiers, predictions, coefficients, model parameters, source text, small cells, denominator drift, unapproved endpoints, unapproved model versions, or unsuppressed subgroup results |
| UK Biobank / All of Us | Human-admin or workbench feasibility | Access-policy labels and partner/admin feasibility | Keep alive as longer-horizon source lanes | Organization/workbench owner | Silent background access, source downloads, row-level egress |
| BioLINCC / MESA / ARIC | High-value institution-gated collaborator lane | Human-admin evidence only | Keep as collaborator/institution lane, not a current technical blocker | Qualified institutional requester or collaborator | Codex inspecting controlled files, source packages, dictionaries, codebooks, rows, or agreement text |

## Lane State Machine

Every source or benchmark lane moves through the same simple state machine:

idea -> metadata labels -> source activation -> locked benchmark design -> execution -> aggregate result review -> promotion review

A lane may not skip states. Local chores inside a state do not require ReviewGPT unless they change the scientific direction, source boundary, benchmark execution, result interpretation, or product boundary.

Moving one source forward does not move any other source forward. Row-cache permission does not imply endpoint extraction, scoring, model mutation, aggregate export, or claims.

Free account creation, terms acceptance, DUA acceptance, credentialed training, or repository login must be performed only by the lawful human/account holder. Codex and other agents may record non-identifying labels that access exists and terms permit the intended research boundary, but must not create accounts, accept terms, store credentials, store agreement text, or silently download account-gated rows.

Sources with noncommercial, academic, public-interest, or product-adjacent restrictions may be used only inside the permitted research boundary. Their results must not be used for product promotion, product model training, user-facing validation claims, or commercial deployment evidence unless source terms explicitly allow that use and a later promotion/source-rights review approves it.

## Result Label Taxonomy

Every future aggregate result must carry exactly one label:

- internal anchor: useful for internal overfit control and model development only
- same-family sanity: useful for plumbing, historical transport, or measurement-family stress, but not true external validation
- true external validation: evidence from a meaningfully different authorized cohort, time, population, measurement pipeline, or source regime
- partner aggregate validation: aggregate-only evidence returned by a lawful data holder running a frozen evaluator in its own environment
- product-promotion evidence: a later label requiring multiple external validations, uncertainty policy, attribution review, source-rights review, and product/legal review

Evidence ladder, from weakest to strongest for product relevance:

1. internal same-source split evidence
2. same-family historical sanity evidence
3. public non-NHANES external validation
4. controlled or cohort external validation
5. partner aggregate validation from a lawful holder
6. Murph-native prospective consented validation

Only true-external, partner aggregate, and prospective Murph-native tiers can eventually support promotion discussions, and even then only after the promotion boundary is separately reviewed.

## Source Handoff Notes

Controlled or account-gated source access is human/admin work, not silent Codex background work. If a human or partner can legally use a source under its terms, that can unblock a future source-activation review, but it does not by itself authorize Codex to inspect files or store source material.

For BioLINCC-style institutional lanes, official starting points remain:

- ARIC BioLINCC study page: `https://biolincc.nhlbi.nih.gov/studies/aric/`
- MESA BioLINCC study page: `https://biolincc.nhlbi.nih.gov/studies/mesa/`
- BioLINCC FAQ: `https://biolincc.nhlbi.nih.gov/faq/`
- BioLINCC User Guide: `https://biolincc.nhlbi.nih.gov/media/BioLINCC_User_Guide_05Jan2026.pdf`

Any controlled files must stay in ignored local runtime storage and must not enter repo-tracked paths, `output-packages/`, chat, ReviewGPT packets, logs, or embeddings.

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
- **Translation Gate:** can risk-to-age mapping, uncertainty display, domain attribution, feature attribution wording, and actionability boundaries be represented without overclaiming?
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
