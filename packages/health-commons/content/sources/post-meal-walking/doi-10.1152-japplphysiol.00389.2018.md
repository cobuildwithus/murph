---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1152-japplphysiol.00389.2018
slug: sources/post-meal-walking/doi-10.1152-japplphysiol.00389.2018
title: Managing free-living hyperglycemia with exercise or interrupted sitting in type 2 diabetes
summary: This free-living type 2 diabetes study suggests distributed sitting interruptions may help some glycemic outcomes, while continuous exercise may be stronger for daily hyperglycemia; it remains adjacent to a fixed every-meal walking protocol.
status: draft
quality: usable
aliases:
- doi:10.1152/japplphysiol.00389.2018
categories:
- post-meal-walking
relations:
-
  type: related_protocol
  target: protocol_variant:post-meal-walking/walking-after-every-meal
-
  type: parent_family
  target: experiment_family:post-meal-walking
source:
  kind: journal_article
  title: Managing free-living hyperglycemia with exercise or interrupted sitting in type 2 diabetes
  authors: Jennifer M. Blankenship; Stuart R. Chipkin; Patty S. Freedson; John Staudenmayer; Kate Lyden; Barry Braun
  year: 2019
  journal: Journal of Applied Physiology
  citation: Jennifer M. Blankenship; Stuart R. Chipkin; Patty S. Freedson; John Staudenmayer; Kate Lyden; Barry Braun. Managing free-living hyperglycemia with exercise or interrupted sitting in type 2 diabetes. Journal of Applied Physiology. 2019. doi:10.1152/japplphysiol.00389.2018.
  doi: 10.1152/japplphysiol.00389.2018
  url: https://doi.org/10.1152/japplphysiol.00389.2018
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    doi: 10.1152/japplphysiol.00389.2018
    url: https://doi.org/10.1152/japplphysiol.00389.2018
  canonicalUrl: https://doi.org/10.1152/japplphysiol.00389.2018
  identityAliases:
  - doi:10.1152/japplphysiol.00389.2018
researchEvidence:
  designKind: crossover_trial
  designLabel: Free-living randomized crossover CGM study
  populationLabel: Adults with type 2 diabetes in a free-living hyperglycemia-management study.
  durationLabel: Free-living intervention days with continuous glucose monitoring; meal-related interruption pattern rather than a fixed every-meal walk prescription.
  aggregateRole: primary
  cohortKey: cohort:doi-10.1152-japplphysiol.00389.2018
  notes:
  - Free-living behavior and activity dose differ from a simple after-every-meal walking rule
  - Exact analyzed sample and effect estimates were not resolved in the extracted record
  - Activity was not limited to walking immediately after each meal
evidenceBucket: sedentary-breaks-standing-micro-walks
whyItMatters: It helps separate continuous exercise from lower-burden sitting interruptions in real-world glucose management.
potentialMurphEndpoints:
- Continuous glucose monitoring hyperglycemia
- Postprandial glucose
- Dose and burden
protocolTakeaway: Treat as context for dose/burden and CGM outcomes; do not claim it directly supports the Murph walking-after-every-meal protocol.
murphTakeaway: Useful signal for comparing one continuous bout versus distributed meal-linked activity in users with CGM data.
studyDesign: crossover
modality: free-living exercise or interrupted sitting
claimUse: context-only
murphV1Priority: Medium
pdfRightsStatus: unknown
---
This source is included for **sedentary-breaks-standing-micro-walks**.

**Findings:** This free-living type 2 diabetes study suggests distributed sitting interruptions may help some glycemic outcomes, while continuous exercise may be stronger for daily hyperglycemia; it remains adjacent to a fixed every-meal walking protocol.

**Why it matters:** It helps separate continuous exercise from lower-burden sitting interruptions in real-world glucose management.

**Potential experiment signals:** Continuous glucose monitoring hyperglycemia, Postprandial glucose, Dose and burden.

**Protocol takeaway:** Treat as context for dose/burden and CGM outcomes; do not claim it directly supports the Murph walking-after-every-meal protocol.

**Claim use:** `context-only`.

## Extraction details

- **Population:** Adults with type 2 diabetes in a free-living hyperglycemia-management study.
- **Participant count:** Participant count not resolved in the extracted record.
- **Intervention/exposure:** Activity delivered either as exercise or as sitting interruptions after meals; walking/exercise time was tested at multiple total daily doses.
- **Comparator/control:** Control/free-living usual sitting pattern and an alternative continuous-exercise strategy.
- **Duration/follow-up:** Free-living intervention days with continuous glucose monitoring; meal-related interruption pattern rather than a fixed every-meal walk prescription.
- **Endpoints:** Continuous glucose monitoring hyperglycemia, Postprandial glucose, Dose and burden
- **Effect estimates or direction:** Available extraction notes indicate both continuous exercise and interrupted sitting lowered some hyperglycemia metrics, with continuous walking/exercise appearing more effective for daily hyperglycemia; exact effect sizes were not extracted.
- **Adverse events/safety notes:** No adverse-event signal was extracted from available metadata.
- **Limitations:** Free-living behavior and activity dose differ from a simple after-every-meal walking rule; Exact analyzed sample and effect estimates were not resolved in the extracted record; Activity was not limited to walking immediately after each meal
- **Population mismatch:** Adjacent variant: type 2 diabetes free-living exercise/sitting-interruption comparator, not direct post-meal walking after every meal.
- **Artifact candidates and rights:** Rights status in the canonical ledger is `unknown`. Keep source-page metadata and external identifiers; do not add copyrighted publisher PDFs to Git unless redistribution rights are independently confirmed.

## Atomic finding links

- `finding:walking-after-every-meal:doi-10.1152-japplphysiol.00389.2018:001`
