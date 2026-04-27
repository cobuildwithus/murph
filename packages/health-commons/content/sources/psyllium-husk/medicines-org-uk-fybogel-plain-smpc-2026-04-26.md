---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:medicines-org-uk-fybogel-plain-smpc-2026-04-26"
slug: "sources/psyllium-husk/medicines-org-uk-fybogel-plain-smpc-2026-04-26"
title: "Fybogel Plain Granules - Summary of Product Characteristics"
summary: "UK SmPC for Fybogel Plain Granules documenting 3.5 g ispaghula husk per sachet, liquid directions, contraindications, medicine interactions, pregnancy/lactation notes, and adverse events."
status: "draft"
quality: "usable"
aliases:
  - "Fybogel Plain Granules - Summary of Product Characteristics"
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
  title: "Fybogel Plain Granules - Summary of Product Characteristics"
  authors: "Medicines.org.uk / electronic Medicines Compendium"
  journal: "electronic Medicines Compendium"
  url: "https://www.medicines.org.uk/emc/product/5652/smpc"
  citation: "Medicines.org.uk / electronic Medicines Compendium. Fybogel Plain Granules - Summary of Product Characteristics. electronic Medicines Compendium. https://www.medicines.org.uk/emc/product/5652/smpc"
sourceIdentity:
  identityKind: "web_page"
  canonicalIdBasis: "url"
  identifiers:
    url: "https://www.medicines.org.uk/emc/product/5652/smpc"
  canonicalUrl: "https://www.medicines.org.uk/emc/product/5652/smpc"
researchEvidence:
  designKind: "other"
  designLabel: "other"
  populationLabel: "Users of ispaghula husk granules, including pregnancy/lactation and product-label populations"
  durationLabel: "Product SmPC; no intervention follow-up."
  aggregateRole: "primary"
  cohortKey: "cohort:medicines-org-uk-fybogel-plain-smpc-2026-04-26:source-population"
  notes:
    - "Batch batch-005 extraction; claim use safety-only."
    - "Limitations: Product label/SmPC; no new clinical effect estimate.; Indications emphasize constipation-related use more than lipid lowering."
    - "Population mismatch: Prescription/OTC product-label context rather than LDL-C self-experiment cohort."
evidenceBucket: "Safety, adverse events, and drug-interaction boundaries"
whyItMatters: "UK SmPC source for pregnancy/lactation, contraindication, interaction, and adverse-event boundaries."
potentialMurphEndpoints:
  - "safety"
  - "pregnancy/lactation"
  - "adverse events"
  - "medication context"
protocolTakeaway: "Protocol safety copy should separate medicines, avoid use in obstruction/swallowing-risk states, and treat pregnancy/lactation as clinician-discussion contexts."
murphTakeaway: "Murph extraction should preserve this source as safety/context evidence and avoid promoting it into a direct LDL-C claim."
studyDesign: "other"
modality: "oral psyllium husk / ispaghula husk safety, tolerability, label, or adjacent context"
claimUse: "safety-only"
sourceFindings:
  -
    findingId: "finding:medicines-org-uk-fybogel-plain-smpc-2026-04-26-fybogel-dose-liquid"
    sourceKey: "source_artifact:medicines-org-uk-fybogel-plain-smpc-2026-04-26"
    extractedFromArtifactId: "art_medicines_org_uk_fybogel_plain_smpc_2026_04_26"
    findingKind: "safety"
    population: "Users of Fybogel Plain Granules."
    exposure: "One sachet containing 3.5 g ispaghula husk taken orally."
    outcome: "Liquid administration requirement."
    summary: "The SmPC directs use in a full glass of water, not before sleep, and warns against taking the granules dry."
    evidenceUse:
      - "safety"
      - "context"
  -
    findingId: "finding:medicines-org-uk-fybogel-plain-smpc-2026-04-26-fybogel-contraindications"
    sourceKey: "source_artifact:medicines-org-uk-fybogel-plain-smpc-2026-04-26"
    extractedFromArtifactId: "art_medicines_org_uk_fybogel_plain_smpc_2026_04_26"
    findingKind: "safety"
    population: "People with swallowing difficulty, GI narrowing/obstruction, fecal impaction, reduced gut motility, or hypersensitivity."
    exposure: "Ispaghula husk granules."
    outcome: "Contraindications and choking/obstruction boundary."
    summary: "The SmPC contraindicates use in several obstructive or swallowing-risk conditions and warns that inadequate fluid can cause choking, intestinal obstruction, or esophageal obstruction."
    evidenceUse:
      - "safety"
  -
    findingId: "finding:medicines-org-uk-fybogel-plain-smpc-2026-04-26-fybogel-interactions"
    sourceKey: "source_artifact:medicines-org-uk-fybogel-plain-smpc-2026-04-26"
    extractedFromArtifactId: "art_medicines_org_uk_fybogel_plain_smpc_2026_04_26"
    findingKind: "safety"
    population: "Users taking oral medicines such as minerals, vitamin B12, cardiac glycosides, coumarins, carbamazepine, lithium, or thyroid hormones."
    exposure: "Ispaghula husk near oral medicines."
    outcome: "Delayed enteral absorption and monitoring/timing."
    summary: "The SmPC states enteral absorption of coadministered medicines can be delayed and recommends separation by half to one hour, with special supervision for diabetes and thyroid hormone users."
    evidenceUse:
      - "safety"
  -
    findingId: "finding:medicines-org-uk-fybogel-plain-smpc-2026-04-26-fybogel-aes-pregnancy"
    sourceKey: "source_artifact:medicines-org-uk-fybogel-plain-smpc-2026-04-26"
    extractedFromArtifactId: "art_medicines_org_uk_fybogel_plain_smpc_2026_04_26"
    findingKind: "safety"
    population: "Users including pregnant or lactating people."
    exposure: "Ispaghula husk exposure."
    outcome: "Adverse events and pregnancy/lactation note."
    summary: "The SmPC lists flatulence/distension, rash, conjunctivitis/rhinitis, bronchospasm/anaphylaxis, and obstruction/fecal impaction; it states use during pregnancy may be considered if necessary due to limited data."
    evidenceUse:
      - "safety"
      - "context"
murphV1Priority: "High"
pdfRightsStatus: "open_access"
interventionOrExposure: "Ispaghula husk oral granules"
comparatorOrControl: "Not applicable or not extracted for this safety/context source."
durationOrFollowUp: "Product SmPC; no intervention follow-up."
endpoints:
  - "safety"
  - "pregnancy/lactation"
  - "adverse events"
  - "medication context"
adverseEventsOrSafetyNotes:
  - "The SmPC directs use in a full glass of water, not before sleep, and warns against taking the granules dry."
  - "The SmPC contraindicates use in several obstructive or swallowing-risk conditions and warns that inadequate fluid can cause choking, intestinal obstruction, or esophageal obstruction."
  - "The SmPC states enteral absorption of coadministered medicines can be delayed and recommends separation by half to one hour, with special supervision for diabetes and thyroid hormone users."
  - "The SmPC lists flatulence/distension, rash, conjunctivitis/rhinitis, bronchospasm/anaphylaxis, and obstruction/fecal impaction; it states use during pregnancy may be considered if necessary due to limited data."
limitations:
  - "Product label/SmPC; no new clinical effect estimate."
  - "Indications emphasize constipation-related use more than lipid lowering."
populationMismatch: "Prescription/OTC product-label context rather than LDL-C self-experiment cohort."
directnessToProtocol: "general_guideline"
---
This source is included for **Safety, adverse events, and drug-interaction boundaries**.

**Findings:**

- `finding:medicines-org-uk-fybogel-plain-smpc-2026-04-26-fybogel-dose-liquid` — The SmPC directs use in a full glass of water, not before sleep, and warns against taking the granules dry.
- `finding:medicines-org-uk-fybogel-plain-smpc-2026-04-26-fybogel-contraindications` — The SmPC contraindicates use in several obstructive or swallowing-risk conditions and warns that inadequate fluid can cause choking, intestinal obstruction, or esophageal obstruction.
- `finding:medicines-org-uk-fybogel-plain-smpc-2026-04-26-fybogel-interactions` — The SmPC states enteral absorption of coadministered medicines can be delayed and recommends separation by half to one hour, with special supervision for diabetes and thyroid hormone users.
- `finding:medicines-org-uk-fybogel-plain-smpc-2026-04-26-fybogel-aes-pregnancy` — The SmPC lists flatulence/distension, rash, conjunctivitis/rhinitis, bronchospasm/anaphylaxis, and obstruction/fecal impaction; it states use during pregnancy may be considered if necessary due to limited data.

**Why it matters:** UK SmPC source for pregnancy/lactation, contraindication, interaction, and adverse-event boundaries.

**Potential experiment signals:**

- safety
- pregnancy/lactation
- adverse events
- medication context

**Protocol takeaway:** Protocol safety copy should separate medicines, avoid use in obstruction/swallowing-risk states, and treat pregnancy/lactation as clinician-discussion contexts.

**Limitations and population mismatch:** Product label/SmPC; no new clinical effect estimate.; Indications emphasize constipation-related use more than lipid lowering. Population mismatch: Prescription/OTC product-label context rather than LDL-C self-experiment cohort.

**Claim use:** `safety-only`.
