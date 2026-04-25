---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:healthquality-va-gov-mdd-guideline-2022-02-01
slug: sources/omega-3-supplementation/healthquality-va-gov-mdd-guideline-2022-02-01
title: VA/DoD Clinical Practice Guideline for the Management of Major Depressive Disorder
summary: VA/DoD guideline suggests against omega-3 for MDD treatment.
status: draft
quality: usable
aliases:
- healthquality-va-gov-mdd-guideline-2022-02-01
categories:
- omega-3-supplementation
relations:
-
  type: related_protocol
  target: protocol_variant:omega-3-supplementation/oral-epa-dha-supplementation
-
  type: parent_family
  target: experiment_family:omega-3-supplementation
source:
  kind: guideline
  title: VA/DoD Clinical Practice Guideline for the Management of Major Depressive Disorder
  authors: VA/DoD Evidence-Based Practice Work Group
  year: 2022
  journal: VA/DoD Clinical Practice Guideline
  citation: VA/DoD Evidence-Based Practice Work Group. VA/DoD Clinical Practice Guideline for the Management of Major Depressive Disorder. VA/DoD Clinical Practice Guideline. 2022.
  url: https://www.healthquality.va.gov/guidelines/MH/mdd/VADODMDDCPGFinal508.pdf
researchEvidence:
  designKind: guideline
  designLabel: Clinical practice guideline
  populationLabel: Adults receiving clinical care for major depressive disorder
  durationLabel: Not applicable
  cohortKey: healthquality-va-gov-mdd-guideline-2022-02-01
evidenceBucket: mood_cognition
whyItMatters: Important negative clinical guideline context.
potentialMurphEndpoints:
- MDD treatment recommendation
protocolTakeaway: VA/DoD guideline suggests against omega-3 for MDD treatment. Applies to MDD treatment decisions, not all omega-3 outcomes.
murphTakeaway: Important negative clinical guideline context.
studyDesign: Clinical practice guideline
modality: oral EPA/DHA or omega-3 fatty acid supplementation
claimUse: context-only
murphV1Priority: High
pdfRightsStatus: permission_required
---
This source is included for **mood_cognition**.

**Findings:** VA/DoD recommends against using omega-3 fatty acids or vitamin D for treatment of MDD; the recommendation is weak against and based on lack of significant overall benefit.

**Why it matters:** Important negative clinical guideline context.

**Potential experiment signals:** MDD treatment recommendation.

**Protocol takeaway:** VA/DoD guideline suggests against omega-3 for MDD treatment. Applies to MDD treatment decisions, not all omega-3 outcomes.

**Claim use:** `context-only`.

## Extraction details

- **Population:** Adults receiving clinical care for major depressive disorder
- **Intervention/exposure:** Omega-3 fatty acids or vitamin D for MDD treatment
- **Comparator/control:** Clinical guideline evidence review and standard treatments
- **Duration/follow-up:** Not applicable
- **Endpoints:** MDD treatment recommendation
- **Effect estimate or direction:** VA/DoD recommends against using omega-3 fatty acids or vitamin D for treatment of MDD; the recommendation is weak against and based on lack of significant overall benefit.
- **Adverse events / safety notes:** No batch-extracted omega-3 adverse-event details.
- **Population mismatch:** Clinical treatment guideline; not direct general-protocol evidence.
- **Artifact rights status:** permission_required

## Limitations

- Guideline scope is MDD treatment, not wellness supplementation.
- Full PDF not staged due rights boundary.
