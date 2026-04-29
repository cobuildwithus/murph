---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: "source_artifact:doi-10.1519-00124278-199805000-00010"
slug: "sources/creatine-supplementation/doi-10.1519-00124278-199805000-00010"
title: "Effect of oral creatine supplementation on near-maximal strength and repeated sets of high-intensity bench press exercise."
summary: "Creatine may improve repeated high-intensity bench performance in trained lifters; label the population boundary."
status: draft
quality: usable
aliases:
  - "Effect of oral creatine supplementation on near-maximal strength and repeated sets of high-intensity bench press exercise."
  - "DOI 10.1519/00124278-199805000-00010"
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
  title: "Effect of oral creatine supplementation on near-maximal strength and repeated sets of high-intensity bench press exercise."
  authors: "Kelly VG; Jenkins DG"
  year: 1998
  journal: "Journal of Strength and Conditioning Research"
  citation: "Kelly VG; Jenkins DG. Effect of oral creatine supplementation on near-maximal strength and repeated sets of high-intensity bench press exercise.. Journal of Strength and Conditioning Research. 1998. doi:10.1519/00124278-199805000-00010."

  doi: "10.1519/00124278-199805000-00010"
  url: "https://doi.org/10.1519/00124278-199805000-00010"
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: "Randomized controlled trial"
  participantCount: 18

  populationLabel: "Male powerlifters with at least 2 years of resistance-training experience."
  durationLabel: "28-day experiment with supplementation on days 2 to 27."
  aggregateRole: primary
  cohortKey: "creatine-monohydrate:doi-10-1519-00124278-199805000-00010"
evidenceBucket: "population_boundary_adjacent_claims"
whyItMatters: "Direct early bench-press performance study in trained lifters."
potentialMurphEndpoints:
  - "3RM bench press"
  - "body mass"
  - "lean body mass"
  - "repeated high-intensity bench-press repetitions"
protocolTakeaway: "Creatine may improve repeated high-intensity bench performance in trained lifters; label the population boundary."
murphTakeaway: "Repeated-set performance may be sensitive for trained users."
studyDesign: "rct"
modality: "supplementation"
claimUse: "supports-protocol"
murphV1Priority: "High"
pdfRightsStatus: "paywalled"
---

This source is included for **population_boundary_adjacent_claims**.

**Findings:** Accessible summaries report increased body mass and lean body mass without percent-body-fat change; both groups improved 3RM bench press, but creatine improved more. Total repeated bench-press repetitions increased with creatine, while placebo did not show comparable changes.

**Why it matters:** Direct early bench-press performance study in trained lifters.

**Potential experiment signals:**
- 3RM bench press
- body mass
- lean body mass
- repeated high-intensity bench-press repetitions

**Protocol takeaway:** Creatine may improve repeated high-intensity bench performance in trained lifters; label the population boundary.

**Murph takeaway:** Repeated-set performance may be sensitive for trained users.

**Population:** Male powerlifters with at least 2 years of resistance-training experience.

**Intervention or exposure:** Oral creatine monohydrate during a 26-day supplementation period.

**Comparator or control:** Placebo/control supplementation.

**Duration or follow-up:** 28-day experiment with supplementation on days 2 to 27.

**Endpoints:**
- 3RM bench press
- body mass
- lean body mass
- repeated high-intensity bench-press repetitions

**Effect estimate or direction:** Accessible summaries report increased body mass and lean body mass without percent-body-fat change; both groups improved 3RM bench press, but creatine improved more. Total repeated bench-press repetitions increased with creatine, while placebo did not show comparable changes.

**Adverse events or safety notes:** No adverse-event details were recovered in the accessible batch extraction.

**Limitations:**
- Small male powerlifter sample.
- Paywalled older source; full table extraction unavailable.

**Population mismatch:** Highly trained male powerlifters; not general-population evidence.

**Directness to Creatine Monohydrate:** `direct_protocol`.

**Claim use:** `supports-protocol`.
