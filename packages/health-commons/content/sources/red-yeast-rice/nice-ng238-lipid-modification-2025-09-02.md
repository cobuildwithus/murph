---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:nice-ng238-lipid-modification-2025-09-02"
slug: "sources/red-yeast-rice/nice-ng238-lipid-modification-2025-09-02"
title: "NICE NG238: cardiovascular risk assessment and lipid modification"
summary: "NICE NG238 provides UK clinical guidance for cardiovascular risk assessment and lipid modification, including baseline full lipid profiles, triglyceride follow-up thresholds, and repeat lipid testing after treatment changes. It is measurement-context evidence only for this red yeast rice protocol."
status: "draft"
quality: "usable"
aliases:
  - "Cardiovascular disease: risk assessment and reduction, including lipid modification (NICE guideline NG238)"
categories:
  - "red-yeast-rice"
  - "lipid-measurement"
relations:
  -
    type: "related_protocol"
    target: "protocol_variant:red-yeast-rice/red-yeast-rice-for-cholesterol"
  -
    type: "parent_family"
    target: "experiment_family:red-yeast-rice"
source:
  kind: "guideline"
  title: "Cardiovascular disease: risk assessment and reduction, including lipid modification (NICE guideline NG238)"
  authors: "National Institute for Health and Care Excellence"
  year: 2023
  journal: "NICE Guidance"
  citation: "National Institute for Health and Care Excellence. Cardiovascular disease: risk assessment and reduction, including lipid modification (NICE guideline NG238). NICE Guidance. 2023."
  url: "https://www.nice.org.uk/guidance/ng238"
sourceIdentity:
  identityKind: "guideline"
  canonicalIdBasis: "url"
  identifiers:
    titleHash: "a4171bab0df58291453e1be35f3e5ad07013e9c993cf52ff7e71f7a084a0c95f"
    url: "https://www.nice.org.uk/guidance/ng238"
  canonicalUrl: "https://www.nice.org.uk/guidance/ng238"
researchEvidence:
  designKind: "guideline"
  designLabel: "NICE clinical guideline"
  populationLabel: "People being assessed for primary or secondary prevention of cardiovascular disease in UK clinical practice."
  durationLabel: "Guideline; follow-up timing includes reassessment after lipid-lowering treatment initiation or change."
  aggregateRole: "context"
  cohortKey: "nice-ng238-lipid-modification-2025-09-02"
  notes:
    - "Comparator/control: Not applicable; guideline recommendations rather than a comparative intervention study."
    - "Effect estimates/direction: No red-yeast-rice effect estimate; operational guidance for lipid testing and follow-up."
    - "Safety notes: Includes baseline and follow-up laboratory context such as liver transaminases before and after lipid-lowering therapy changes; not a red yeast rice safety study."
    - "Population mismatch: Guideline population is broad cardiovascular-prevention care; individual red yeast rice self-experimenters may not match NICE risk strata or medication pathways."
evidenceBucket: "Lipid measurement and test-plan context"
whyItMatters: "Clear operational guidance on baseline labs and follow-up timing that can inform a protocol test plan without implying RYR efficacy."
potentialMurphEndpoints:
  - "Total cholesterol"
  - "HDL-C"
  - "LDL-C"
  - "non-HDL-C"
  - "triglycerides"
  - "liver transaminases"
protocolTakeaway: "Use as context for the protocol measurement plan: collect a full lipid profile and consider repeat testing, especially when triglycerides are high; do not use this guideline as evidence that red yeast rice lowers cholesterol."
murphTakeaway: "Best used as a test-plan guardrail for lipid measurements and follow-up timing."
studyDesign: "guideline"
modality: "lipid measurement and dyslipidemia guideline context"
claimUse: "context-only"
directnessToProtocol: "measurement_context"
interventionOrExposure: "Cardiovascular risk assessment and lipid-modification monitoring with a full lipid profile and triglyceride follow-up thresholds."
comparatorOrControl: "Not applicable; guideline recommendations rather than a comparative intervention study."
effectEstimatesOrDirection: "No red-yeast-rice effect estimate; operational guidance for lipid testing and follow-up."
adverseEventsOrSafetyNotes: "Includes baseline and follow-up laboratory context such as liver transaminases before and after lipid-lowering therapy changes; not a red yeast rice safety study."
limitations:
  - "Jurisdiction-specific UK guideline."
  - "Not a trial of red yeast rice or any supplement."
  - "Treatment recommendations are clinician-facing and should not be treated as supplement efficacy evidence."
populationMismatch: "Guideline population is broad cardiovascular-prevention care; individual red yeast rice self-experimenters may not match NICE risk strata or medication pathways."
sourceFindings:
  -
    findingId: "finding:nice-ng238-lipid-modification-2025-09-02-full-lipid-profile-follow-up"
    sourceKey: "source_artifact:nice-ng238-lipid-modification-2025-09-02"
    findingKind: "context"
    population: "People assessed for primary or secondary prevention of cardiovascular disease."
    exposure: "NICE lipid-modification assessment and follow-up recommendations."
    outcome: "Full lipid profile and triglyceride-aware follow-up testing."
    summary: "NICE NG238 recommends using a full lipid profile for lipid-modification assessment and provides follow-up logic for high triglycerides and repeat lipid testing after lipid-lowering treatment changes. This is measurement-plan context, not red yeast rice efficacy evidence."
    evidenceUse:
      - "measurement"
      - "context"
murphV1Priority: "Medium"
pdfRightsStatus: "unknown"
---
This source is included for **Lipid measurement and test-plan context**.

**Findings:** NICE NG238 recommends using a full lipid profile for lipid-modification assessment and provides follow-up logic for high triglycerides and repeat lipid testing after lipid-lowering treatment changes. This is measurement-plan context, not red yeast rice efficacy evidence.

**Why it matters:** Clear operational guidance on baseline labs and follow-up timing that can inform a protocol test plan without implying RYR efficacy.

**Potential experiment signals:** Baseline full lipid profile before intervention.; Follow-up LDL-C/non-HDL-C/triglyceride testing after treatment change.; Flag high triglycerides because calculated LDL-C may be unreliable..

**Protocol takeaway:** Use as context for the protocol measurement plan: collect a full lipid profile and consider repeat testing, especially when triglycerides are high; do not use this guideline as evidence that red yeast rice lowers cholesterol.

**Claim use:** `context-only`.

**Limitations and directness:** Directness is `measurement_context`. Jurisdiction-specific UK guideline. Not a trial of red yeast rice or any supplement. Treatment recommendations are clinician-facing and should not be treated as supplement efficacy evidence. Population mismatch: Guideline population is broad cardiovascular-prevention care; individual red yeast rice self-experimenters may not match NICE risk strata or medication pathways.
