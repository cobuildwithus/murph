---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:ema-plantaginis-ovatae-seminis-tegumentum-2026-04-26"
slug: "sources/psyllium-husk/ema-plantaginis-ovatae-seminis-tegumentum-2026-04-26"
title: "Plantaginis ovatae seminis tegumentum - herbal medicinal product"
summary: "EMA herbal medicinal product page for ispaghula husk summarizing use as a dietary adjunct in hypercholesterolaemia, required liquid intake, medicine spacing, contraindications, and adverse reactions."
status: "draft"
quality: "usable"
aliases:
  - "Plantaginis ovatae seminis tegumentum - herbal medicinal product"
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
  kind: "guideline"
  title: "Plantaginis ovatae seminis tegumentum - herbal medicinal product"
  authors: "European Medicines Agency / Committee on Herbal Medicinal Products"
  journal: "European Medicines Agency"
  url: "https://www.ema.europa.eu/en/medicines/herbal/plantaginis-ovatae-seminis-tegumentum"
  citation: "European Medicines Agency / Committee on Herbal Medicinal Products. Plantaginis ovatae seminis tegumentum - herbal medicinal product. European Medicines Agency. https://www.ema.europa.eu/en/medicines/herbal/plantaginis-ovatae-seminis-tegumentum"
sourceIdentity:
  identityKind: "guideline"
  canonicalIdBasis: "url"
  identifiers:
    url: "https://www.ema.europa.eu/en/medicines/herbal/plantaginis-ovatae-seminis-tegumentum"
  canonicalUrl: "https://www.ema.europa.eu/en/medicines/herbal/plantaginis-ovatae-seminis-tegumentum"
researchEvidence:
  designKind: "guideline"
  designLabel: "guideline"
  populationLabel: "Adults using ispaghula husk for constipation, stool softening, or as dietary adjunct in hypercholesterolaemia"
  durationLabel: "Regulatory monograph context; no single intervention follow-up."
  aggregateRole: "primary"
  cohortKey: "cohort:ema-plantaginis-ovatae-seminis-tegumentum-2026-04-26:source-population"
  notes:
    - "Batch batch-005 extraction; claim use safety-only."
    - "Limitations: Regulatory monograph; details depend on supporting documents.; European product and terminology context: ispaghula husk / Plantago ovata seed husk."
    - "Population mismatch: General herbal-medicine labeling rather than Murph self-experiment data."
evidenceBucket: "Safety, adverse events, and drug-interaction boundaries"
whyItMatters: "Professional regulatory monograph directly addressing ispaghula husk use, contraindications, liquid intake, timing around medicines, and allergy concerns."
potentialMurphEndpoints:
  - "hydration"
  - "medication absorption"
  - "bloating"
  - "allergy"
  - "obstruction"
  - "dysphagia"
protocolTakeaway: "Protocol guardrails should include liquid intake, timing away from medicines, allergy risk, and clinician oversight for cholesterol use."
murphTakeaway: "Murph extraction should preserve this source as safety/context evidence and avoid promoting it into a direct LDL-C claim."
studyDesign: "guideline"
modality: "oral psyllium husk / ispaghula husk safety, tolerability, label, or adjacent context"
claimUse: "safety-only"
sourceFindings:

  -
    findingId: "finding:ema-plantaginis-ovatae-seminis-tegumentum-2026-04-26-ema-cholesterol-supervision"
    sourceKey: "source_artifact:ema-plantaginis-ovatae-seminis-tegumentum-2026-04-26"
    extractedFromArtifactId: "art_ema_plantaginis_ovatae_seminis_tegumentum_2026_04_26"
    findingKind: "context"
    population: "Adults using ispaghula husk as an adjunct to diet in hypercholesterolaemia."
    exposure: "Plantago ovata/ispaghula husk."
    outcome: "Medical-supervision boundary for cholesterol use."
    summary: "EMA describes ispaghula husk as usable as a dietary adjunct in hypercholesterolaemia, but states that use in that indication requires medical supervision."
    evidenceUse:
      - "context"
      - "safety"
  -
    findingId: "finding:ema-plantaginis-ovatae-seminis-tegumentum-2026-04-26-ema-liquid-med-timing"
    sourceKey: "source_artifact:ema-plantaginis-ovatae-seminis-tegumentum-2026-04-26"
    extractedFromArtifactId: "art_ema_plantaginis_ovatae_seminis_tegumentum_2026_04_26"
    findingKind: "safety"
    population: "Users taking ispaghula husk and oral medicines."
    exposure: "Ispaghula husk with liquids and around medicines."
    outcome: "Hydration and medicine-timing directions."
    summary: "EMA advises taking ispaghula husk with plenty of liquid and separating it from other medicines by about half to one hour."
    evidenceUse:
      - "safety"
  -
    findingId: "finding:ema-plantaginis-ovatae-seminis-tegumentum-2026-04-26-ema-allergy-obstruction"
    sourceKey: "source_artifact:ema-plantaginis-ovatae-seminis-tegumentum-2026-04-26"
    extractedFromArtifactId: "art_ema_plantaginis_ovatae_seminis_tegumentum_2026_04_26"
    findingKind: "safety"
    population: "Users with swallowing problems, gut narrowing, or allergy risk; handlers exposed to powder."
    exposure: "Ispaghula husk ingestion or inhalation of powder."
    outcome: "Obstruction and allergy adverse-event boundaries."
    summary: "EMA lists flatulence/distension, dry stool if insufficient liquid, allergic reactions including bronchospasm and anaphylaxis, and avoidance by people with swallowing difficulty or gastrointestinal narrowing."
    evidenceUse:
      - "safety"
murphV1Priority: "High"
pdfRightsStatus: "open_access"
interventionOrExposure: "Ispaghula husk / Plantago ovata seed husk"
comparatorOrControl: "Not applicable or not extracted for this safety/context source."
durationOrFollowUp: "Regulatory monograph context; no single intervention follow-up."
endpoints:
  - "hydration"
  - "medication absorption"
  - "bloating"
  - "allergy"
  - "obstruction"
  - "dysphagia"
adverseEventsOrSafetyNotes:
  - "EMA advises taking ispaghula husk with plenty of liquid and separating it from other medicines by about half to one hour."
  - "EMA lists flatulence/distension, dry stool if insufficient liquid, allergic reactions including bronchospasm and anaphylaxis, and avoidance by people with swallowing difficulty or gastrointestinal narrowing."
limitations:
  - "Regulatory monograph; details depend on supporting documents."
  - "European product and terminology context: ispaghula husk / Plantago ovata seed husk."
populationMismatch: "General herbal-medicine labeling rather than Murph self-experiment data."
directnessToProtocol: "general_guideline"
---
This source is included for **Safety, adverse events, and drug-interaction boundaries**.

**Findings:**

- `finding:ema-plantaginis-ovatae-seminis-tegumentum-2026-04-26-ema-cholesterol-supervision` — EMA describes ispaghula husk as usable as a dietary adjunct in hypercholesterolaemia, but states that use in that indication requires medical supervision.
- `finding:ema-plantaginis-ovatae-seminis-tegumentum-2026-04-26-ema-liquid-med-timing` — EMA advises taking ispaghula husk with plenty of liquid and separating it from other medicines by about half to one hour.
- `finding:ema-plantaginis-ovatae-seminis-tegumentum-2026-04-26-ema-allergy-obstruction` — EMA lists flatulence/distension, dry stool if insufficient liquid, allergic reactions including bronchospasm and anaphylaxis, and avoidance by people with swallowing difficulty or gastrointestinal narrowing.

**Why it matters:** Professional regulatory monograph directly addressing ispaghula husk use, contraindications, liquid intake, timing around medicines, and allergy concerns.

**Potential experiment signals:**

- hydration
- medication absorption
- bloating
- allergy
- obstruction
- dysphagia

**Protocol takeaway:** Protocol guardrails should include liquid intake, timing away from medicines, allergy risk, and clinician oversight for cholesterol use.

**Limitations and population mismatch:** Regulatory monograph; details depend on supporting documents.; European product and terminology context: ispaghula husk / Plantago ovata seed husk. Population mismatch: General herbal-medicine labeling rather than Murph self-experiment data.

**Claim use:** `safety-only`.
