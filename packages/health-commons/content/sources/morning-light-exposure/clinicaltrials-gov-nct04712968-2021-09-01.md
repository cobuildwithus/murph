---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:clinicaltrials-gov-nct04712968-2021-09-01"
slug: "sources/morning-light-exposure/clinicaltrials-gov-nct04712968-2021-09-01"
title: "Efficacy of Daylight as Adjunctive Treatment in Patients With Depression"
summary: "Terminated randomized feasibility trial registry of 30 minutes/day outdoor morning daylight before 1 PM for depressed outpatients."
status: "draft"
quality: "usable"
aliases:
  - "NCT04712968 morning daylight adjunctive depression trial"
categories:
  - "morning-light-exposure"
relations:
  -
    type: "related_protocol"
    target: "protocol_variant:morning-light-exposure/morning-outdoor-light-exposure"
  -
    type: "parent_family"
    target: "experiment_family:morning-light-exposure"
source:
  kind: "web_page"
  title: "Efficacy of Daylight as Adjunctive Treatment in Patients With Depression"
  authors: "ClinicalTrials.gov; University of Aarhus"
  year: 2021
  journal: "ClinicalTrials.gov"
  citation: "ClinicalTrials.gov. Efficacy of Daylight as Adjunctive Treatment in Patients With Depression. NCT04712968. Study start September 1, 2021; last updated August 8, 2022."
  url: "https://clinicaltrials.gov/study/NCT04712968"
researchEvidence:
  designKind: "randomized_controlled_trial"
  designLabel: "Randomized controlled feasibility trial registry; terminated with actual enrollment reported by registry mirror"
  participantCount: 12
  participantCountKind: "reported"
  populationLabel: "Outpatients aged 18–50 years with unipolar depression receiving stable antidepressant treatment"
  durationLabel: "Six-week intervention: minimum 30 minutes outdoors in morning daylight before 1 PM each day"
  aggregateRole: "context"
  cohortKey: "nct04712968-daylight-adjunctive-depression"
protocolEvidence:
  -
    protocolKey: "protocol_variant:morning-light-exposure/morning-outdoor-light-exposure"
    groupId: "safety-boundaries"
    stance: "safety_boundary"
    scope: "clinical_supervised"
    result: "not_efficacy_evidence"
    endpointKeys:
      - "biomarker:sleep-quality"
    headline: "Registry specified a six-week outdoor morning-daylight protocol of at least 30 minutes/day before 1 PM."
    implication: "Useful for dose/timing design and adherence tooling, but not for efficacy claims."
    caveat: "Terminated registry with actual enrollment of 12 and no extracted published results."
    displayPriority: 65
evidenceBucket: "direct_outdoor_daylight_protocol"
whyItMatters: "Shows a clinically supervised protocol variant very close to Morning Outdoor Light Exposure, including timing, duration, tracker use, and a treatment-as-usual comparator."
potentialMurphEndpoints:
  - "daily outdoor daylight adherence"
  - "depressive symptoms"
  - "sleep quality"
  - "well-being"
  - "personal light tracker exposure"
protocolTakeaway: "A clinical trial protocol used at least 30 minutes/day outdoors before 1 PM, but the terminated registry should not be used as efficacy evidence."
murphTakeaway: "Use as protocol-design context for timing and adherence support, not as evidence that the habit works."
studyDesign: "Trial registry / randomized controlled feasibility trial"
modality: "outdoor morning daylight with light tracker and psychoeducation"
claimUse: "context-only"
murphV1Priority: "High"
pdfRightsStatus: "unknown"
---

This source is included for **direct_outdoor_daylight_protocol**.

**Findings:** The registry/mirror describes a randomized trial in depressed outpatients: Group 1 was asked to stay outdoors in daylight for a minimum of 30 minutes/day before 1 PM for 6 weeks, with psychoeducation plus a personal light tracker/app; the control group received treatment as usual and wore a tracker without being introduced to the app. Outcomes were depressive symptoms, sleep quality, and well-being. The study was terminated and no efficacy results were extracted; actual participant count was reported as 12 in the registry mirror.

**Why it matters:** Shows a clinically supervised protocol variant very close to Morning Outdoor Light Exposure, including timing, duration, tracker use, and a treatment-as-usual comparator.

**Potential experiment signals:** daily outdoor daylight adherence, depressive symptoms, sleep quality, well-being, personal light tracker exposure

**Protocol takeaway:** A clinical trial protocol used at least 30 minutes/day outdoors before 1 PM, but the terminated registry should not be used as efficacy evidence.

**Claim use:** `context-only`.
