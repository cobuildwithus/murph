---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:sauna-bibliography-2026-04-18
slug: sources/sauna/sauna-bibliography-2026-04-18
title: Sauna research bibliography
summary: Research map for the Finnish dry-sauna experiment, summarizing the sauna literature review, long-term context, short-term physiology, and dose-design caveats.
status: field-testing
quality: usable
categories:
  - sauna
relations:

  -
    type: related_protocol
    target: protocol_variant:dry-sauna/murph-finnish-standard-3x-week
  -
    type: related_protocol
    target: experiment_family:dry-sauna
  -
    type: parent_family
    target: experiment_family:sauna
  -
    type: cites
    target: source_artifact:pmid-16871826
  -
    type: cites
    target: source_artifact:pmid-29849692
  -
    type: cites
    target: source_artifact:mayo-2018-sauna-review
  -
    type: cites
    target: source_artifact:pmid-32814462
  -
    type: cites
    target: source_artifact:pmid-38577299
  -
    type: cites
    target: source_artifact:pmid-23411620
  -
    type: cites
    target: source_artifact:pmid-9972494
  -
    type: cites
    target: source_artifact:doi-10.1155-2014-106049
  -
    type: cites
    target: source_artifact:pmid-38344040
  -
    type: cites
    target: source_artifact:pmid-32615263
  -
    type: cites
    target: source_artifact:pmid-41049507
  -
    type: cites
    target: source_artifact:pmid-39762944
  -
    type: cites
    target: source_artifact:pmid-34363927
  -
    type: cites
    target: source_artifact:pmid-11874249
  -
    type: cites
    target: source_artifact:pmid-22505948
  -
    type: cites
    target: source_artifact:pmid-29720543
  -
    type: cites
    target: source_artifact:pmid-31293098
  -
    type: cites
    target: source_artifact:pmid-38836690
  -
    type: cites
    target: source_artifact:pmid-24304490
  -
    type: cites
    target: source_artifact:pmid-30800676
  -
    type: cites
    target: source_artifact:pmid-24899780
  -
    type: cites
    target: source_artifact:pmid-3218892
  -
    type: cites
    target: source_artifact:pmid-3218894
  -
    type: cites
    target: source_artifact:pmid-3218897
source:
  kind: other
  title: Sauna research bibliography
  authors: Health Commons Research
  year: 2026
  journal: Health Commons research curation
  citation: Health Commons Research. Sauna research bibliography. Prepared 2026-04-18.
researchEvidence:
  designKind: "bibliography"
  designLabel: "Bibliography"
  aggregateRole: "context"
  aggregationNote: "Curation artifact; excluded from participant aggregation."
evidenceBucket: Research curation
whyItMatters: This is the structured source map behind the first dry-sauna experiment and evidence review.
potentialMurphEndpoints:
  - Protocol design
  - source discovery
  - evidence map
  - safety-screening bibliography
protocolTakeaway: Treat this as a research map and curation artifact, not as primary evidence.
studyDesign: Research bibliography / curation artifact
modality: Mixed sauna and passive heat literature with Finnish dry-sauna emphasis
finnishDrySaunaFocus: Yes or Likely subset included
murphV1Priority: High
aliases:
  - sauna bibliography 2026
  - sauna research corpus
corpusStats:
  masterRecords: 180
  finnishDrySaunaSubsetRecords: 81
  reviewMetaRecords: 32
  curatedShortlistRecords: 40
  highPriorityRecords: 24
  mediumPriorityRecords: 65
  lowerPriorityRecords: 91
  finnishDrySaunaYesRecords: 36
  finnishDrySaunaYesOrLikelyRecords: 81
  earliestYear: 1978
  latestYear: 2026
  auditCutoff: 2026-04-18
supplementalReview:
  reviewedAt: 2026-04-21
  addedSourceCount: 19
  scopeNote: Broader sauna literature additions and corrected Finnish dry-sauna citation records are held on the sauna and dry-sauna evidence graph; the Bryan Johnson protocol page remains source-attributed to Bryan Johnson / Blueprint posts and mirrors.
  sourceKeys:
    - source_artifact:pmid-23411620
    - source_artifact:pmid-9972494
    - source_artifact:doi-10.1155-2014-106049
    - source_artifact:pmid-38344040
    - source_artifact:pmid-32615263
    - source_artifact:pmid-41049507
    - source_artifact:pmid-39762944
    - source_artifact:pmid-34363927
    - source_artifact:pmid-11874249
    - source_artifact:pmid-22505948
    - source_artifact:pmid-29720543
    - source_artifact:pmid-31293098
    - source_artifact:pmid-38836690
    - source_artifact:pmid-24304490
    - source_artifact:pmid-30800676
    - source_artifact:pmid-24899780
    - source_artifact:pmid-3218892
    - source_artifact:pmid-3218894
    - source_artifact:pmid-3218897
  finnishDrySaunaOrLikelySourceKeys:
    - source_artifact:pmid-23411620
    - source_artifact:pmid-9972494
    - source_artifact:doi-10.1155-2014-106049
    - source_artifact:pmid-38344040
    - source_artifact:pmid-32615263
    - source_artifact:pmid-34363927
    - source_artifact:pmid-11874249
    - source_artifact:pmid-29720543
    - source_artifact:pmid-31293098
    - source_artifact:pmid-38836690
    - source_artifact:pmid-24304490
    - source_artifact:pmid-30800676
    - source_artifact:pmid-24899780
    - source_artifact:pmid-3218892
    - source_artifact:pmid-3218894
    - source_artifact:pmid-3218897
  bucketCounts:
    fertilityAndMaleHeatSafety: 2
    acuteThermalDoseAndSafety: 2
    acuteVascularPhysiology: 2
    passiveHeatSynthesis: 2
    explanatoryBackboneReview: 1
    sweatAndDetoxClaimCaveats: 2
    strokeAndFitnessCohortContext: 2
    classicFinnishPhysiologyAndFluidBalance: 3
    postExerciseAndBodyCompositionContext: 2
    dryVsSteamModalityContext: 1
evidenceMap:
  recordTypeCounts:
    reviewMeta: 32
    primaryStudy: 96
    primaryOther: 52
  focusCounts:
    unclear: 54
    no: 45
    likely: 45
    yes: 36
  priorityCounts:
    lower: 91
    medium: 65
    high: 24
  domainCounts:
    cardiovascular: 55
    general-mixed: 36
    safety-physiology: 32
    exercise-recovery: 20
    respiratory-ent: 11
    neuro-mental: 8
    cardiometabolic: 7
    symptoms-musculoskeletal: 6
    mechanistic-biomarkers: 5
  modalityCounts:
    sauna-unspecified-likely-dry: 66
    finnish-dry-sauna: 36
    sauna-likely-dry: 29
    heat-therapy-adjacent: 20
    waon-far-infrared-dry-sauna: 11
    other-unclear: 9
    infrared-sauna: 6
    dry-sauna-exercise-adjunct: 3
  shortlistBucketCounts:
    long-term-finnish-cohort-evidence: 14
    intervention-design-reality-checks: 13
    acute-and-mechanistic: 8
    evidence-backbone: 5
backboneSourceKeys:
  - source_artifact:pmid-16871826
  - source_artifact:pmid-29849692
  - source_artifact:mayo-2018-sauna-review
  - source_artifact:pmid-32814462
  - source_artifact:pmid-38577299
shortlistSourceKeys:
  - source_artifact:pmid-29849692
  - source_artifact:mayo-2018-sauna-review
  - source_artifact:pmid-32814462
  - source_artifact:pmid-38577299
  - source_artifact:pmid-41032138
  - source_artifact:pmid-25705824
  - source_artifact:pmid-29229091
  - source_artifact:pmid-28905164
  - source_artifact:pmid-27932366
  - source_artifact:pmid-28633297
  - source_artifact:pmid-28972808
  - source_artifact:pmid-29897261
  - source_artifact:pmid-30486813
  - source_artifact:pmid-29720543
  - source_artifact:pmid-31372865
  - source_artifact:pmid-35908583
  - source_artifact:pmid-36255556
  - source_artifact:pmid-37029766
  - source_artifact:pmid-38410962
  - source_artifact:pmid-29269746
  - source_artifact:pmid-31126559
  - source_artifact:pmid-31331560
  - source_artifact:pmid-32951736
  - source_artifact:pmid-34622026
  - source_artifact:pmid-36813265
  - source_artifact:doi-10.1152-ajpregu.00012.2025
  - source_artifact:doi-10.1080-23328940.2026.2645467
  - source_artifact:pmid-25432420
  - source_artifact:pmid-31490429
  - source_artifact:pmid-31869820
  - source_artifact:pmid-33211153
  - source_artifact:pmid-34297227
  - source_artifact:pmid-34199101
  - source_artifact:pmid-35710395
  - source_artifact:pmid-35785965
  - source_artifact:pmid-34727008
  - source_artifact:pmid-37650138
  - source_artifact:doi-10.3390-app151910762
  - source_artifact:pmid-40611569
  - source_artifact:pmid-41831305
finnishDrySaunaSourceKeys:
  - source_artifact:pmid-445022
  - source_artifact:sauna-1986-kauppinen-man-in-the-sauna-review-article
  - source_artifact:pmid-3766176
  - source_artifact:pmid-3788622
  - source_artifact:sauna-1988-eisalo-the-finnish-sauna-and-cardiovascular-diseases
  - source_artifact:sauna-1988-kukkonen-harjula-how-the-sauna-affects-the-endocrine-system
  - source_artifact:sauna-1988-laitinen-lungs-and-ventilation-in-the-sauna
  - source_artifact:pmid-3174262
  - source_artifact:sauna-1989-kauppinen-sauna-shower-and-ice-water-immersion-physiological-respons
  - source_artifact:sauna-1989-kauppinen-sauna-shower-and-ice-water-immersion-physiological-respons-2
  - source_artifact:sauna-1989-kauppinen-sauna-shower-and-ice-water-immersion-physiological-respons-3
  - source_artifact:sauna-1989-kauppinen-some-endocrine-responses-to-sauna-shower-and-ice-water-imm
  - source_artifact:sauna-1989-kukkonen-harjula-haemodynamic-and-hormonal-responses-to-heat-exposure-in-a
  - source_artifact:sauna-1989-markkola-sauna-habits-and-related-symptoms-in-finnish-children
  - source_artifact:sauna-1990-ernst-regular-sauna-bathing-and-the-incidence-of-common-colds
  - source_artifact:sauna-1990-jokinen-children-in-sauna-cardiovascular-adjustment
  - source_artifact:sauna-1991-jokinen-children-in-sauna-electrocardiographic-abnormalities
  - source_artifact:sauna-1992-roine-alcohol-and-sauna-bathing-effects-on-cardiac-rhythm-blood
  - source_artifact:sauna-1994-kukkonen-harjula-cardiovascular-effects-of-atenolol-scopolamine-and-their-c
  - source_artifact:sauna-1996-vanakoski-effects-of-heat-exposure-in-a-finnish-sauna-on-the-pharmac
  - source_artifact:sauna-1997-kauppinen-facts-and-fables-about-sauna
  - source_artifact:sauna-2000-keast-the-finnish-sauna-bath-and-its-use-in-patients-with-cardio
  - source_artifact:pmid-11165553
  - source_artifact:sauna-2005-miyamoto-safety-and-efficacy-of-repeated-sauna-bathing-in-patients
  - source_artifact:pmid-16871826
  - source_artifact:pmid-19154844
  - source_artifact:sauna-2014-gryka-the-effect-of-sauna-bathing-on-lipid-profile-in-young-phys
  - source_artifact:sauna-2015-kanji-efficacy-of-regular-sauna-bathing-for-chronic-tension-type
  - source_artifact:pmid-25705824
  - source_artifact:pmid-25432420
  - source_artifact:pmid-26152773
  - source_artifact:pmid-29229091
  - source_artifact:pmid-28905164
  - source_artifact:pmid-27932366
  - source_artifact:pmid-28633297
  - source_artifact:pmid-29351426
  - source_artifact:pmid-29849692
  - source_artifact:pmid-28972808
  - source_artifact:pmid-29897261
  - source_artifact:pmid-29269746
  - source_artifact:mayo-2018-sauna-review
  - source_artifact:pmid-30173212
  - source_artifact:pmid-30486813
  - source_artifact:pmid-31126559
  - source_artifact:pmid-29720543
  - source_artifact:pmid-31372865
  - source_artifact:pmid-31102597
  - source_artifact:pmid-31331560
  - source_artifact:pmid-32951736
  - source_artifact:pmid-31950931
  - source_artifact:pmid-31490429
  - source_artifact:pmid-31869820
  - source_artifact:pmid-33513711
  - source_artifact:pmid-33211153
  - source_artifact:pmid-34297227
  - source_artifact:pmid-34622026
  - source_artifact:pmid-34199101
  - source_artifact:pmid-36078656
  - source_artifact:pmid-35710395
  - source_artifact:pmid-35908583
  - source_artifact:pmid-36255556
  - source_artifact:pmid-35785965
  - source_artifact:pmid-34727008
  - source_artifact:pmid-38011189
  - source_artifact:pmid-37650138
  - source_artifact:pmid-37270272
  - source_artifact:pmid-37029766
  - source_artifact:pmid-36813265
  - source_artifact:pmid-39446139
  - source_artifact:pmid-38410962
  - source_artifact:pmid-38577299
  - source_artifact:doi-10.3390-app151910762
  - source_artifact:pmid-40202605
  - source_artifact:pmid-41426898
  - source_artifact:doi-10-1016-j-aimed-2024-09-009
  - source_artifact:pmid-40611569
  - source_artifact:pmid-41340471
  - source_artifact:doi-10-3389-fcvm-2025-1537194
  - source_artifact:pmid-41461792
  - source_artifact:pmid-41831305
  - source_artifact:doi-10.1080-23328940.2026.2645467
---

## What this is

This page represents the structured sauna research corpus behind the Finnish dry-sauna experiment. It is a curation artifact, not a primary study.

## Corpus at a glance

- 180 master bibliography records
- 81 records in the Finnish dry-sauna yes/likely subset
- 32 review or meta-analysis records
- 40 papers on the curated source list
- 24 high-priority records for the first dry-sauna experiment
- publication window 1978–2026
- audit cutoff 2026-04-18
- 81 Finnish dry-sauna yes/likely records now materialized as source pages and linked to the canonical protocol

## Supplemental 2026-04-21 review

A follow-up source pass added nineteen targeted records for gaps that matter when comparing high-burden sauna routines against the broader evidence graph:

- male fertility and heat-safety guardrails: Garolla 2013 and Saikhun 1998
- acute dose, core-temperature, and extreme-heat safety context: Zalewski 2014 and Podstawski 2024
- acute vascular context: Gravel 2019 and Gravel 2021
- mixed or cautious passive-heat syntheses: Hamaya 2025 and Solomon 2025
- public mechanism synthesis: Patrick and Johnson 2021
- sweat, minerals, and detox-claim calibration: Hoshi 2001 and Sears 2012
- corrected Finnish stroke and cardiorespiratory-fitness cohort context: Kunutsor 2018 and Kunutsor 2024
- post-exercise, repeated-dose, and dry-vs-steam context: Sutkowy 2014, Podstawski 2019, and Pilch 2014
- classic Finnish löyly, thermoregulation, and body-fluid-balance context: Helamaa 1988, Leppäluoto 1988, and Ahonen 1988

The 2026-04-18 corpus counts above are preserved as the original audit snapshot. These supplemental records are tracked separately so the data does not pretend that the whole workbook was re-audited.

The Bryan Johnson protocol page intentionally remains source-attributed to Bryan Johnson / Blueprint posts and mirrors. These broader papers belong to the dry-sauna and parent sauna evidence graph, not to Bryan Johnson's protocol-specific research cards.

## Source groups

- Evidence backbone: 5
- Long-term Finnish cohort evidence: 14
- Acute and mechanistic: 8
- Intervention design / reality checks: 13

## How to use this evidence

Use this page to understand how deep the sauna research base is, which evidence buckets are strongest for protocol design, and why the Finnish dry-sauna experiment separates long-term context from short-term measurable signals.

- The **evidence backbone** papers help define the overall research base and safety framing.
- The **long-term Finnish cohort** papers are rationale and screening context, not 21-day signals; the stroke cohort should now point to PMID 29720543 rather than the reader-response PMID 30665914.
- The **acute and mechanistic** papers help pick measurable session and near-term signals.
- The **intervention design / reality checks** papers stop the protocol from overclaiming and help define how to standardize timing, hydration, exercise context, and expected latency.

## Important caution

This page is not itself evidence that a sauna protocol works. It is the map used to build a bounded, user-readable protocol from the underlying literature.
