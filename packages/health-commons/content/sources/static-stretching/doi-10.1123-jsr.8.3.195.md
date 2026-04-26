---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1123/jsr.8.3.195
slug: sources/static-stretching/doi-10.1123-jsr.8.3.195
title: Effects of static and hold-relax stretching on hamstring range of motion using the FlexAbility LE1000
summary: Older randomized trial comparing static stretching and hold-relax PNF-style stretching for hamstring ROM; included as foundational PNF/static boundary evidence.
status: draft
quality: usable
aliases:
- doi-10.1123/jsr.8.3.195
- Gribble 1999 static hold-relax hamstring ROM
categories:
- static-stretching
relations:
-
  type: related_protocol
  target: protocol_variant:static-stretching/at-home-static-stretching-for-flexibility
-
  type: parent_family
  target: experiment_family:static-stretching
source:
  kind: journal_article
  title: Effects of static and hold-relax stretching on hamstring range of motion using the FlexAbility LE1000
  authors: Gribble PA, Guskiewicz KM, Prentice WE, Shields EW
  year: 1999
  journal: Journal of Sport Rehabilitation
  citation: Gribble PA, Guskiewicz KM, Prentice WE, Shields EW. Effects of static and hold-relax stretching on hamstring range of motion using the FlexAbility LE1000. Journal of Sport Rehabilitation. 1999;8(3):195-208. doi:10.1123/jsr.8.3.195
  doi: 10.1123/jsr.8.3.195
  url: https://doi.org/10.1123/jsr.8.3.195
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: Randomized trial comparing static stretching, hold-relax stretching, and control
  populationLabel: Healthy college-aged participants aged 18 to 25 years
  durationLabel: Training protocol duration not fully retrieved from accessible snippets
  aggregateRole: primary
  cohortKey: gribble-1999-static-hold-relax-hamstring-rom
  participantCount: 42
  participantCountKind: reported
evidenceBucket: adjacent_variants_recovery_modalities
whyItMatters: Classic static-versus-hold-relax comparison repeatedly cited in PNF boundary literature.
potentialMurphEndpoints:
- hamstring ROM
- active knee-extension test
- measurement context
protocolTakeaway: Use as comparator context only; hold-relax stretching is a PNF-style adjacent variant.
murphTakeaway: Static stretching and hold-relax stretching are distinct interventions even when the endpoint is hamstring ROM.
studyDesign: Randomized controlled trial
modality: Static stretching versus hold-relax stretching
directness: adjacent_variant
claimUse: context-only
populationMismatch: College-aged sample and device-based hamstring testing; not unsupervised home stretching.
sourceLimitations:
- Paywalled; result extraction limited
- Older measurement instrumentation
- Comparator includes PNF-style hold-relax
murphV1Priority: Medium
pdfRightsStatus: paywalled
---

This source is included for **adjacent_variants_recovery_modalities**.

**Findings:** Forty-two participants aged 18 to 25 were assigned to control, static stretching, or hold-relax stretching. The accessible record confirms hamstring ROM measurement with the FlexAbility LE1000 and active knee-extension test; exact between-group effect estimates were not retrieved.

**Why it matters:** Classic static-versus-hold-relax comparison repeatedly cited in PNF boundary literature.

**Potential experiment signals:** hamstring ROM, active knee-extension test, measurement context.

**Protocol takeaway:** Use as comparator context only; hold-relax stretching is a PNF-style adjacent variant.

**Claim use:** `context-only`.

## Extraction notes

- **Directness:** `adjacent_variant`.
- **Population:** Healthy college-aged participants aged 18 to 25 years.
- **Intervention or exposure:** Static stretching versus hold-relax stretching.
- **Duration or follow-up:** Training protocol duration not fully retrieved from accessible snippets.
- **Population mismatch:** College-aged sample and device-based hamstring testing; not unsupervised home stretching.
- **Adverse events or safety notes:** No adverse-event signal was retrieved from accessible materials.
- **Limitations:** Paywalled; result extraction limited; Older measurement instrumentation; Comparator includes PNF-style hold-relax.
- **Artifact/rights note:** PDF rights status is `paywalled`; do not commit copyrighted PDFs to Git.
