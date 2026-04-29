---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: "source_artifact:doi-10.1016-j.aehs.2026.01.001"
slug: "sources/creatine-supplementation/doi-10.1016-j.aehs.2026.01.001"
title: "Effects of different creatine monohydrate supplementation strategies and resistance-band training in untrained healthy adults (≥ 50 years of age)."
summary: "3 g/day and 5 g/day may affect different endpoints in older untrained adults; generalize cautiously."
status: draft
quality: usable
aliases:
  - "Effects of different creatine monohydrate supplementation strategies and resistance-band training in untrained healthy adults (≥ 50 years of age)."
  - "DOI 10.1016/j.aehs.2026.01.001"
categories:
  - "creatine-supplementation"
relations:

  -
    type: "related_protocol"
    target: "protocol_variant:creatine-supplementation/creatine-monohydrate"
  -
    type: "parent_family"
    target: "experiment_family:creatine-supplementation"
source:
  kind: "journal_article"
  title: "Effects of different creatine monohydrate supplementation strategies and resistance-band training in untrained healthy adults (≥ 50 years of age)."
  authors: "Rusterholz F et al."
  year: 2026
  journal: "Advanced Exercise and Health Science"
  citation: "Rusterholz F et al.. Effects of different creatine monohydrate supplementation strategies and resistance-band training in untrained healthy adults (≥ 50 years of age).. Advanced Exercise and Health Science. 2026. doi:10.1016/j.aehs.2026.01.001."

  doi: "10.1016/j.aehs.2026.01.001"
  url: "https://www.sciencedirect.com/science/article/pii/S2950273X26000020"
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: "Randomized controlled trial"
  participantCount: 39

  populationLabel: "Healthy untrained adults aged at least 50 years."
  durationLabel: "16 weeks."
  aggregateRole: primary
  cohortKey: "creatine-monohydrate:doi-10-1016-j-aehs-2026-01-001"
evidenceBucket: "population_boundary_adjacent_claims"
whyItMatters: "Recent direct dose-strategy RCT in a pragmatic older-adult training context."
potentialMurphEndpoints:
  - "skeletal muscle mass index"
  - "lower-body lean mass"
  - "relative chest press strength"
  - "subcutaneous fat"
  - "lower-body strength"
protocolTakeaway: "3 g/day and 5 g/day may affect different endpoints in older untrained adults; generalize cautiously."
murphTakeaway: "Track dose, training mode, chest press, and body composition separately."
studyDesign: "rct"
modality: "supplementation_plus_training"
claimUse: "supports-protocol"
murphV1Priority: "High"
pdfRightsStatus: "unknown"
---

This source is included for **population_boundary_adjacent_claims**.

**Findings:** Small RCT randomized 39 and reported 35 completers. Extracted results: 5 g/day favored skeletal muscle mass index and lower-body lean mass; 3 g/day favored relative chest-press strength versus placebo and lower total subcutaneous fat versus 5 g/day; creatine independent of dose improved chest-press strength over time versus placebo. No lower-body strength effect was extracted.

**Why it matters:** Recent direct dose-strategy RCT in a pragmatic older-adult training context.

**Potential experiment signals:**
- skeletal muscle mass index
- lower-body lean mass
- relative chest press strength
- subcutaneous fat
- lower-body strength

**Protocol takeaway:** 3 g/day and 5 g/day may affect different endpoints in older untrained adults; generalize cautiously.

**Murph takeaway:** Track dose, training mode, chest press, and body composition separately.

**Population:** Healthy untrained adults aged at least 50 years.

**Intervention or exposure:** Daily creatine monohydrate strategies during 16 weeks of high-repetition resistance-band training: 5 g/day, 3 g/day, or placebo-matched dosing.

**Comparator or control:** Placebo plus the same resistance-band training.

**Duration or follow-up:** 16 weeks.

**Endpoints:**
- skeletal muscle mass index
- lower-body lean mass
- relative chest press strength
- subcutaneous fat
- lower-body strength

**Effect estimate or direction:** Small RCT randomized 39 and reported 35 completers. Extracted results: 5 g/day favored skeletal muscle mass index and lower-body lean mass; 3 g/day favored relative chest-press strength versus placebo and lower total subcutaneous fat versus 5 g/day; creatine independent of dose improved chest-press strength over time versus placebo. No lower-body strength effect was extracted.

**Adverse events or safety notes:** Withdrawals included injuries described as unrelated in accessible extraction; no supplement-specific adverse-event signal was recovered.

**Limitations:**
- Small trial.
- Older untrained resistance-band population.
- Rights status unknown; do not add PDFs without verification.

**Population mismatch:** Adults ≥50, untrained, resistance-band training context.

**Directness to Creatine Monohydrate:** `direct_protocol`.

**Claim use:** `supports-protocol`.
