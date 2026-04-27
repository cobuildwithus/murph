---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:justia-pharmanex-v-shalala-2000-07-21"
slug: "sources/red-yeast-rice/justia-pharmanex-v-shalala-2000-07-21"
title: "Pharmanex, Inc. v. Shalala, 221 F.3d 1151 (10th Cir. 2000)"
summary: "Tenth Circuit decision reversing and remanding in a dispute over FDA treatment of Cholestin, a red yeast rice product containing lovastatin/mevinolin."
status: "draft"
quality: "usable"
aliases:
  - "Pharmanex v. Shalala Cholestin red yeast rice legal decision"
categories:
  - "red-yeast-rice"
  - "regulatory"
  - "safety"
relations:
  -
    type: "related_protocol"
    target: "protocol_variant:red-yeast-rice/red-yeast-rice-for-cholesterol"
  -
    type: "parent_family"
    target: "experiment_family:red-yeast-rice"
source:
  kind: "other"
  title: "Pharmanex, Inc. v. Shalala, 221 F.3d 1151 (10th Cir. 2000)"
  authors: "United States Court of Appeals for the Tenth Circuit"
  year: 2000
  journal: "Federal Reporter / Justia"
  citation: "Pharmanex, Inc. v. Shalala, 221 F.3d 1151 (10th Cir. 2000)."
  url: "https://law.justia.com/cases/federal/appellate-courts/F3/221/1151/473359/"
sourceIdentity:
  identityKind: "other"
  canonicalIdBasis: "url"
  identifiers:
    titleHash: "9e0e93058c197be919ea2c3c8e132c88cf137419cb13588c2faf26607a3145c6"
    url: "https://law.justia.com/cases/federal/appellate-courts/F3/221/1151/473359/"
  canonicalUrl: "https://law.justia.com/cases/federal/appellate-courts/F3/221/1151/473359/"
researchEvidence:
  designKind: "other"
  designLabel: "Legal decision"
  populationLabel: "Legal/regulatory context for Cholestin and red yeast rice products; no study participants."
  durationLabel: "Not applicable"
  aggregateRole: "primary"
  cohortKey: "justia-pharmanex-v-shalala-2000-07-21"
evidenceBucket: "Regulatory and jurisdiction warnings"
whyItMatters: "Explains a foundational U.S. legal boundary around red yeast rice products containing lovastatin-like constituents."
potentialMurphEndpoints:
  - "jurisdiction"
  - "product drug-status"
  - "monacolin/lovastatin content"
protocolTakeaway: "Use as legal context only; it does not establish efficacy or safety."
murphTakeaway: "Red yeast rice protocol language should avoid implying that lovastatin-containing RYR products are universally permissible supplements."
studyDesign: "Legal decision"
modality: "Red yeast rice regulatory, product-quality, or safety context"
claimUse: "safety-only"
sourceFindings:
  -
    findingKind: "context"
    population: "U.S. red yeast rice regulatory/legal context"
    exposure: "Cholestin red yeast rice product containing mevinolin/lovastatin"
    outcome: "Dietary supplement versus drug-status legal boundary"
    summary: "The Tenth Circuit reversed the district court and upheld FDA’s statutory interpretation that Cholestin did not meet the dietary supplement definition and was subject to drug regulation, providing legal context for lovastatin-containing red yeast rice products."
    evidenceUse:
      - "context"
      - "safety"
    findingId: "finding:justia-pharmanex-v-shalala-2000-07-21-legal-drug-boundary"
    sourceKey: "source_artifact:justia-pharmanex-v-shalala-2000-07-21"
    extractedFromArtifactId: "art_justia_pharmanex_v_shalala_2000_07_21_html"
murphV1Priority: "Medium"
pdfRightsStatus: "open_access"
artifacts:
  -
    artifactId: "art_justia_pharmanex_v_shalala_2000_07_21_html"
    sourceKey: "source_artifact:justia-pharmanex-v-shalala-2000-07-21"
    kind: "html"
    storage: "external"
    sourceUrl: "https://law.justia.com/cases/federal/appellate-courts/F3/221/1151/473359/"
    rightsStatus: "open_access"
    redistributable: false
    accessNotes: "External source artifact candidate only; copyrighted or externally hosted materials were not stored in Git during this extraction."
extractedEvidence:
  population: "Legal/regulatory context for Cholestin and red yeast rice products; no study participants."
  interventionOrExposure: "Cholestin red yeast rice extract containing mevinolin/lovastatin, chemically identical to Mevacor active ingredient."
  comparatorOrControl: "None"
  durationOrFollowUp: "Not applicable"
  endpoints:
    - "dietary supplement definition"
    - "drug exclusion boundary"
    - "FDA authority"
  effectEstimatesOrDirection: "The court held FDA’s interpretation of the dietary-supplement exclusion was not arbitrary, capricious, or manifestly contrary to statute."
  adverseEventsOrSafetyNotes: "Safety considerations are indirect; source addresses legal identity and regulatory authority rather than adverse-event outcomes."
  limitations: "Legal source; not a biomedical study and not a current FDA guidance page."
  populationMismatch: "Regulatory, product-quality, or safety context; not a Murph self-experiment cohort."
  directnessToProtocol: "general_guideline"
---
This source is included for **Regulatory and jurisdiction warnings**.

**Findings:** Tenth Circuit decision reversing and remanding in a dispute over FDA treatment of Cholestin, a red yeast rice product containing lovastatin/mevinolin.

**Why it matters:** Explains a foundational U.S. legal boundary around red yeast rice products containing lovastatin-like constituents.

**Potential experiment signals:** jurisdiction, product drug-status, monacolin/lovastatin content.

**Protocol takeaway:** Use as legal context only; it does not establish efficacy or safety.

**Claim use:** `safety-only`.
