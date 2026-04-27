---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:ismpcanada-psyllium-choking-2025-06-24"
slug: "sources/psyllium-husk/ismpcanada-psyllium-choking-2025-06-24"
title: "Fatal Choking Incident Associated with Inappropriate Use of Psyllium"
summary: "ISMP Canada safety bulletin describing a fatal choking incident in a long-term-care resident with dysphagia after psyllium powder was prepared with applesauce/inadequate liquid rather than adequate liquid."
status: "draft"
quality: "usable"
aliases:
  - "Fatal Choking Incident Associated with Inappropriate Use of Psyllium"
categories:
  - "psyllium-husk"
relations:
  -
    type: "related_protocol"
    target: "protocol_variant:psyllium-husk/psyllium-husk-for-cholesterol"
  -
    type: "parent_family"
    target: "experiment_family:psyllium-husk"
source:
  kind: "web_page"
  title: "Fatal Choking Incident Associated with Inappropriate Use of Psyllium"
  authors: "Institute for Safe Medication Practices Canada"
  year: 2025
  journal: "ISMP Canada Safety Bulletin"
  url: "https://ismpcanada.ca/safety-bulletins/safety-bulletins/?vol=2025-volume-25"
  citation: "Institute for Safe Medication Practices Canada. (2025). Fatal Choking Incident Associated with Inappropriate Use of Psyllium. ISMP Canada Safety Bulletin. https://ismpcanada.ca/safety-bulletins/safety-bulletins/?vol=2025-volume-25"
sourceIdentity:
  identityKind: "web_page"
  canonicalIdBasis: "url"
  identifiers:
    url: "https://ismpcanada.ca/safety-bulletins/safety-bulletins/?vol=2025-volume-25"
  canonicalUrl: "https://ismpcanada.ca/safety-bulletins/safety-bulletins/?vol=2025-volume-25"
researchEvidence:
  designKind: "single_person_report"
  designLabel: "case report"
  populationLabel: "Long-term care resident with dysphagia; older/frail safety-boundary population"
  durationLabel: "Single fatal incident report."
  aggregateRole: "primary"
  cohortKey: "cohort:ismpcanada-psyllium-choking-2025-06-24:source-population"
  notes:
    - "Batch batch-005 extraction; claim use safety-only."
    - "Limitations: Single incident report.; Long-term-care resident with dysphagia is a high-risk population that does not match typical self-experiment users."
    - "Population mismatch: Long-term-care/dysphagia context; not general healthy adult cholesterol use."
  participantCount: 1
  participantCountKind: "reported"
evidenceBucket: "Safety, adverse events, and drug-interaction boundaries"
whyItMatters: "Recent serious adverse-event safety signal for dysphagia/long-term-care boundaries and fluid-administration instructions."
potentialMurphEndpoints:
  - "safety"
  - "adverse events"
  - "elderly"
  - "dysphagia"
  - "population mismatch"
protocolTakeaway: "Protocol exclusions should explicitly include dysphagia/swallowing difficulty and should not instruct mixing psyllium into applesauce or thickened foods."
murphTakeaway: "Murph extraction should preserve this source as safety/context evidence and avoid promoting it into a direct LDL-C claim."
studyDesign: "case_report"
modality: "oral psyllium husk / ispaghula husk safety, tolerability, label, or adjacent context"
claimUse: "safety-only"
sourceFindings:
  -
    findingId: "finding:ismpcanada-psyllium-choking-2025-06-24-ismp-fatal-dysphagia"
    sourceKey: "source_artifact:ismpcanada-psyllium-choking-2025-06-24"
    extractedFromArtifactId: "art_ismpcanada_psyllium_choking_2025_06_24"
    findingKind: "adverse_event"
    population: "Long-term-care resident with dysphagia."
    exposure: "Psyllium powder administered in a food/pureed context with inadequate liquid after prior preparation-instruction issues."
    outcome: "Fatal choking/esophageal mass compressing airway."
    summary: "ISMP Canada reported a fatal choking incident after psyllium was given to a resident with dysphagia, emphasizing that psyllium is contraindicated in dysphagia and should be mixed with adequate liquid rather than food such as applesauce."
    evidenceUse:
      - "safety"
  -
    findingId: "finding:ismpcanada-psyllium-choking-2025-06-24-ismp-system-factors"
    sourceKey: "source_artifact:ismpcanada-psyllium-choking-2025-06-24"
    extractedFromArtifactId: "art_ismpcanada_psyllium_choking_2025_06_24"
    findingKind: "safety"
    population: "Health care teams administering bulk-forming products to people with dysphagia."
    exposure: "Medication administration workflows and labeling/website instructions for psyllium."
    outcome: "Preventability and communication failures."
    summary: "The bulletin identified system contributors including overlooked preparation instructions, insufficient decision support, and incomplete communication of adequate liquid volume and dysphagia contraindications."
    evidenceUse:
      - "safety"
      - "context"
murphV1Priority: "High"
pdfRightsStatus: "unknown"
interventionOrExposure: "Psyllium given inappropriately with inadequate liquid/pureed food context"
comparatorOrControl: "Not applicable or not extracted for this safety/context source."
durationOrFollowUp: "Single fatal incident report."
endpoints:
  - "safety"
  - "adverse events"
  - "elderly"
  - "dysphagia"
  - "population mismatch"
adverseEventsOrSafetyNotes:
  - "ISMP Canada reported a fatal choking incident after psyllium was given to a resident with dysphagia, emphasizing that psyllium is contraindicated in dysphagia and should be mixed with adequate liquid rather than food such as applesauce."
  - "The bulletin identified system contributors including overlooked preparation instructions, insufficient decision support, and incomplete communication of adequate liquid volume and dysphagia contraindications."
limitations:
  - "Single incident report."
  - "Long-term-care resident with dysphagia is a high-risk population that does not match typical self-experiment users."
populationMismatch: "Long-term-care/dysphagia context; not general healthy adult cholesterol use."
directnessToProtocol: "general_guideline"
---
This source is included for **Safety, adverse events, and drug-interaction boundaries**.

**Findings:**

- `finding:ismpcanada-psyllium-choking-2025-06-24-ismp-fatal-dysphagia` — ISMP Canada reported a fatal choking incident after psyllium was given to a resident with dysphagia, emphasizing that psyllium is contraindicated in dysphagia and should be mixed with adequate liquid rather than food such as applesauce.
- `finding:ismpcanada-psyllium-choking-2025-06-24-ismp-system-factors` — The bulletin identified system contributors including overlooked preparation instructions, insufficient decision support, and incomplete communication of adequate liquid volume and dysphagia contraindications.

**Why it matters:** Recent serious adverse-event safety signal for dysphagia/long-term-care boundaries and fluid-administration instructions.

**Potential experiment signals:**

- safety
- adverse events
- elderly
- dysphagia
- population mismatch

**Protocol takeaway:** Protocol exclusions should explicitly include dysphagia/swallowing difficulty and should not instruct mixing psyllium into applesauce or thickened foods.

**Limitations and population mismatch:** Single incident report.; Long-term-care resident with dysphagia is a high-risk population that does not match typical self-experiment users. Population mismatch: Long-term-care/dysphagia context; not general healthy adult cholesterol use.

**Claim use:** `safety-only`.
