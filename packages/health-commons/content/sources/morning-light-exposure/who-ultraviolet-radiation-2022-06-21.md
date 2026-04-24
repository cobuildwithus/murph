---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:who-ultraviolet-radiation-2022-06-21"
slug: "sources/morning-light-exposure/who-ultraviolet-radiation-2022-06-21"
title: "Ultraviolet radiation"
summary: "WHO fact sheet on ultraviolet radiation, health effects, risk groups, and protective measures."
status: "draft"
quality: "usable"
aliases:
  - "World Health Organization 2022 Ultraviolet radiation"
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
  title: "Ultraviolet radiation"
  authors: "World Health Organization"
  year: 2022
  journal: "WHO"
  citation: "World Health Organization. Ultraviolet radiation. WHO. 2022."
  url: "https://www.who.int/news-room/fact-sheets/detail/ultraviolet-radiation"
researchEvidence:
  designKind: "guideline"
  designLabel: "Guideline or consensus recommendation"
  populationLabel: "General population, including children/adolescents, fair-skinned people, people taking photosensitizing medications, outdoor workers, and people with skin-cancer risk factors."
  durationLabel: "Not applicable."
  aggregateRole: "primary"
  cohortKey: "cohort:who-ultraviolet-radiation-2022-06-21"
protocolEvidence:
  -
    protocolKey: "protocol_variant:morning-light-exposure/morning-outdoor-light-exposure"
    groupId: "safety-boundaries"
    stance: "safety_boundary"
    scope: "general_guideline"
    result: "not_efficacy_evidence"
    headline: "WHO UV guidance distinguishes beneficial small UV exposure from excessive UV risk and recommends protection at UVI 3 or above."
    implication: "Outdoor-light protocols should not equate more sun with better outcomes; use UV Index and protection measures."
    caveat: "Safety-only public-health guidance."
    displayPriority: 70
evidenceBucket: "safety_boundaries"
whyItMatters: "WHO UV guidance distinguishes beneficial small UV exposure from excessive UV risk and recommends protection at UVI 3 or above."
potentialMurphEndpoints:
  - "skin cancer"
  - "sunburn"
  - "phototoxic/photoallergic reactions"
  - "cataract"
  - "photokeratitis"
  - "UV Index"
  - "protection measures"
protocolTakeaway: "Outdoor-light protocols should not equate more sun with better outcomes; use UV Index and protection measures."
murphTakeaway: "Outdoor-light protocols should not equate more sun with better outcomes; use UV Index and protection measures."
studyDesign: "guideline"
modality: "solar UV public-health guidance"
claimUse: "safety-only"
murphV1Priority: "High"
pdfRightsStatus: "open_access"
---

This source is included for **safety_boundaries**.

**Source key:** `source_artifact:who-ultraviolet-radiation-2022-06-21`.

**Findings:** WHO states that skin cancers are caused primarily by UV radiation from sun or artificial sources, that small UV amounts can support vitamin D, and that sun protection is recommended when the UV Index is 3 or above; protective measures include shade, clothing, broad-brimmed hats, wraparound sunglasses, and broad-spectrum sunscreen for uncovered skin.

**Why it matters:** WHO UV guidance distinguishes beneficial small UV exposure from excessive UV risk and recommends protection at UVI 3 or above.

**Potential experiment signals:** skin cancer, sunburn, phototoxic/photoallergic reactions, cataract, photokeratitis, UV Index, protection measures.

**Protocol takeaway:** Outdoor-light protocols should not equate more sun with better outcomes; use UV Index and protection measures.

**Claim use:** `safety-only`.

**Extraction notes:**

- **Participant count:** not applicable.
- **Population:** General population, including children/adolescents, fair-skinned people, people taking photosensitizing medications, outdoor workers, and people with skin-cancer risk factors.
- **Intervention or exposure:** Solar ultraviolet radiation exposure.
- **Comparator or control:** Not applicable public-health fact sheet.
- **Duration or follow-up:** Not applicable.
- **Endpoints:** skin cancer; sunburn; phototoxic/photoallergic reactions; cataract; photokeratitis; UV Index; protection measures
- **Effect estimates or direction:** WHO states that skin cancers are caused primarily by UV radiation from sun or artificial sources, that small UV amounts can support vitamin D, and that sun protection is recommended when the UV Index is 3 or above; protective measures include shade, clothing, broad-brimmed hats, wraparound sunglasses, and broad-spectrum sunscreen for uncovered skin.
- **Adverse events or safety notes:** Excessive UV exposure is associated with acute and chronic skin and eye harms, including sunburn, phototoxic/photoallergic reactions, photokeratitis, cataract, pterygium, and cancers in or around the eye.
- **Population mismatch:** General public-health guidance.
- **Directness to Morning Outdoor Light Exposure:** Safety boundary. This source does not establish direct efficacy for the protocol variant.

**Directness and boundaries:** Safety-only public-health guidance.

**Limitations and uncertainty:**

- Public-health fact sheet, not a protocol trial.
- Does not specify circadian-light dose.
- Protection needs vary by UV Index, latitude, altitude, reflection, skin type, age, and medications.

**Artifact and rights notes:** Rights status guess is `open_access`. Do not commit copyrighted PDFs to Git unless rights are confirmed open and redistributable. Manifest entry needed: `false`.
