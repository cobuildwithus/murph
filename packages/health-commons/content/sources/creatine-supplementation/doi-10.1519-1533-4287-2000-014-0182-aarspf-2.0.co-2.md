---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: "source_artifact:doi-10.1519-1533-4287-2000-014-0182-aarspf-2.0.co-2"
slug: "sources/creatine-supplementation/doi-10.1519-1533-4287-2000-014-0182-aarspf-2.0.co-2"
title: "Absolute and Relative Strength Performance Following Creatine Monohydrate Supplementation Combined With Periodized Resistance Training."
summary: "Randomized periodized resistance-training trial in young men; creatine loading and maintenance did not clearly outperform placebo when relative training load and volume were equalized, except for one bench-press volume signal after acute loading."
status: draft
quality: usable
aliases:
  - "Syrotuik 2000 creatine periodized resistance training"
  - "Absolute and relative strength performance following creatine monohydrate"
categories:
  - creatine-supplementation
relations:
  -
    type: related_protocol
    target: "protocol_variant:creatine-supplementation/creatine-monohydrate"
  -
    type: parent_family
    target: "experiment_family:creatine-supplementation"
source:
  kind: "journal_article"
  title: "Absolute and Relative Strength Performance Following Creatine Monohydrate Supplementation Combined With Periodized Resistance Training."
  authors: "Daniel G. Syrotuik; Gordon J. Bell; Robert Burnham; Lorraine L. Sim; Robert A. Calvert; Ian M. MacLean"
  year: 2000
  journal: "Journal of Strength and Conditioning Research"
  citation: "Syrotuik DG, Bell GJ, Burnham R, Sim LL, Calvert RA, MacLean IM. Absolute and Relative Strength Performance Following Creatine Monohydrate Supplementation Combined With Periodized Resistance Training. J Strength Cond Res. 2000;14(2):182-190. doi:10.1519/1533-4287(2000)014<0182:AARSPF>2.0.CO;2."

  doi: "10.1519/1533-4287(2000)014<0182:AARSPF>2.0.CO;2"
  url: "https://journals.lww.com/nsca-jscr/abstract/2000/05000/absolute_and_relative_strength_performance.11.aspx"
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: "Randomized placebo-controlled periodized resistance-training trial"
  participantCount: 21

  populationLabel: "Men aged 20-26 years in a periodized resistance-training program"
  durationLabel: "5-day loading phase plus 32-day maintenance/training phase"
  aggregateRole: primary
  cohortKey: "syrotuik-2000-periodized-training"
evidenceBucket: "strength_hypertrophy_trials"
whyItMatters: "Adds a direct, small RCT that helps prevent overclaiming; it tested creatine monohydrate with periodized resistance training but found mostly null between-group effects."
potentialMurphEndpoints:
  - "bench press 1RM"
  - "leg press 1RM"
  - "training volume at 80% 1RM"
  - "strength-to-body-mass ratio"
  - "body mass"
protocolTakeaway: "Include as mixed direct evidence: creatine monohydrate did not clearly outperform placebo across most strength and volume endpoints when training loads and volumes were matched."
murphTakeaway: "Track training program structure, volume, and progression; this source is a reminder that creatine is not a guaranteed strength multiplier in every resistance-training setup."
studyDesign: "Randomized placebo-controlled resistance-training trial"
modality: "Creatine monohydrate plus periodized resistance training"
claimUse: context-only
murphV1Priority: High
pdfRightsStatus: paywalled
---

This source is included for **strength_hypertrophy_trials**.

**Findings:** `source_artifact:doi-10.1519-1533-4287-2000-014-0182-aarspf-2.0.co-2` — In 21 young men, acute loading was compared with placebo maintenance, acute loading plus creatine maintenance, and placebo during periodized resistance training. The trial reported no clear between-group advantage for 1RM strength, lifting volume, or strength-to-body-mass ratio across the full training period, except a bench-press total-lifting-volume signal after acute loading.

**Why it matters:** Adds a direct, small RCT that helps prevent overclaiming; it tested creatine monohydrate with periodized resistance training but found mostly null between-group effects.

**Potential experiment signals:** bench press 1RM; incline leg press 1RM; total lifting volume at 80% 1RM; strength-to-body-mass ratio; body mass.

**Protocol takeaway:** Include as mixed direct evidence: creatine monohydrate did not clearly outperform placebo across most strength and volume endpoints when training loads and volumes were matched.

**Limitations and extraction boundary:** Small sample of young men. All groups followed equalized relative training loads and volumes, which may reduce transfer to less controlled real-world training. Accessible abstract-level extraction did not report adverse events. Group-level effect sizes were not fully available in the extracted record.

**Claim use:** `context-only`.
