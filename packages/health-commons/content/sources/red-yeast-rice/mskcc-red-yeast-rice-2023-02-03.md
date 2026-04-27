---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:mskcc-red-yeast-rice-2023-02-03"
slug: "sources/red-yeast-rice/mskcc-red-yeast-rice-2023-02-03"
title: "Red Yeast Rice"
summary: "Memorial Sloan Kettering Cancer Center About Herbs page describing red yeast rice statin-like constituents, uncertain safety of over-the-counter products, adverse-event case reports, and drug-interaction boundaries."
status: "draft"
quality: "usable"
aliases:
  - "MSK About Herbs red yeast rice"
  - "MSKCC red yeast rice"
categories:
  - "red-yeast-rice"
relations:
  -
    type: "related_protocol"
    target: "protocol_variant:red-yeast-rice/red-yeast-rice-for-cholesterol"
  -
    type: "parent_family"
    target: "experiment_family:red-yeast-rice"
source:
  kind: "web_page"
  title: "Red Yeast Rice"
  authors: "Memorial Sloan Kettering Cancer Center"
  year: 2023
  journal: "MSK About Herbs, Botanicals & Other Products"
  citation: "Memorial Sloan Kettering Cancer Center. Red Yeast Rice. About Herbs, Botanicals & Other Products. Updated February 3, 2023."
  url: "https://www.mskcc.org/cancer-care/integrative-medicine/herbs/red-yeast-rice"
sourceIdentity:
  identityKind: "web_page"
  canonicalIdBasis: "url"
  identifiers:
    titleHash: "6f1d256a0b92ae935b637375418d25ff4225331d9c548ed248d54fbc702b9c7c"
    url: "https://www.mskcc.org/cancer-care/integrative-medicine/herbs/red-yeast-rice"
  canonicalUrl: "https://www.mskcc.org/cancer-care/integrative-medicine/herbs/red-yeast-rice"
researchEvidence:
  designKind: "other"
  designLabel: "Clinical herb-reference page"
  populationLabel: "Patients and clinicians considering red yeast rice, including people with cancer or comorbid medication exposure"
  durationLabel: "Not applicable; clinical reference page"
  aggregateRole: "context"
  cohortKey: "mskcc-2023-red-yeast-rice-herb-reference"
  notes:
    - "No participant count is reported for the clinical reference page."
evidenceBucket: "Interactions, contraindications, and population boundaries"
whyItMatters: "MSKCC directly connects red yeast rice to lovastatin-like activity and statin-like adverse effects, making it useful for onboarding exclusions and symptom monitoring."
potentialMurphEndpoints:
  - "concurrent-lipid-drug-screen"
  - "CYP3A4-P-gp-substrate-screen"
  - "grapefruit-intake-screen"
  - "ALT/AST"
  - "CK"
  - "muscle-symptom-log"
  - "liver-symptom-log"
protocolTakeaway: "Use as a safety boundary: avoid combining red yeast rice with cholesterol-lowering drugs or interaction-prone drugs without clinician review; monitor muscle and liver symptoms."
murphTakeaway: "MSKCC supports statin-like safety framing and interaction screening; it is not a standalone protocol efficacy source."
studyDesign: "Clinical herb-reference page"
modality: "Red yeast rice supplement / lovastatin-like monacolin exposure"
directness: "general_guideline"
claimUse: "safety-only"
sourceFindings:
  -
    findingId: "finding:mskcc-ryr-statin-like-safety-boundary"
    findingKind: "safety"
    population: "People considering red yeast rice supplements"
    exposure: "Red yeast rice containing monacolin K, a lovastatin-like constituent"
    outcome: "Statin-like adverse-effect and medication-combination boundary"
    summary: "MSKCC describes red yeast rice as containing monacolin K/lovastatin-like activity and cautions that it can produce statin-like adverse effects and should not be combined with cholesterol-lowering drugs without supervision."
    evidenceUse:
      - "safety"
    sourceKey: "source_artifact:mskcc-red-yeast-rice-2023-02-03"
  -
    findingId: "finding:mskcc-ryr-case-reports-adverse-effects"
    findingKind: "adverse_event"
    population: "Case-report patients exposed to red yeast rice products"
    exposure: "Red yeast rice supplement use"
    outcome: "Myopathy, rhabdomyolysis, hepatotoxicity, and other reported adverse events"
    summary: "MSKCC lists case reports of myopathy, rhabdomyolysis, hepatotoxicity, and additional serious events after red yeast rice exposure, supporting symptom and laboratory safety monitoring."
    evidenceUse:
      - "safety"
    sourceKey: "source_artifact:mskcc-red-yeast-rice-2023-02-03"
  -
    findingId: "finding:mskcc-ryr-cyp3a4-pgp-substrates"
    findingKind: "safety"
    population: "People taking CYP3A4 substrates, P-glycoprotein substrates, grapefruit, or other interaction-relevant exposures"
    exposure: "Red yeast rice plus CYP3A4/P-gp substrate or grapefruit exposure"
    outcome: "Drug-interaction boundary"
    summary: "MSKCC flags CYP3A4 and P-glycoprotein substrate concerns and grapefruit interaction context, which should trigger medication-list review before protocol use."
    evidenceUse:
      - "safety"
      - "mechanism"
    sourceKey: "source_artifact:mskcc-red-yeast-rice-2023-02-03"
murphV1Priority: "High"
pdfRightsStatus: "unknown"
---
This source is included for **Interactions, contraindications, and population boundaries**.

**Findings:**
- `finding:mskcc-ryr-statin-like-safety-boundary` — MSKCC describes red yeast rice as containing monacolin K/lovastatin-like activity and cautions that it can produce statin-like adverse effects and should not be combined with cholesterol-lowering drugs without supervision.
- `finding:mskcc-ryr-case-reports-adverse-effects` — MSKCC lists case reports of myopathy, rhabdomyolysis, hepatotoxicity, and additional serious events after red yeast rice exposure, supporting symptom and laboratory safety monitoring.
- `finding:mskcc-ryr-cyp3a4-pgp-substrates` — MSKCC flags CYP3A4 and P-glycoprotein substrate concerns and grapefruit interaction context, which should trigger medication-list review before protocol use.

**Why it matters:** MSKCC directly connects red yeast rice to lovastatin-like activity and statin-like adverse effects, making it useful for onboarding exclusions and symptom monitoring.

**Potential experiment signals:** concurrent-lipid-drug-screen, CYP3A4-P-gp-substrate-screen, grapefruit-intake-screen, ALT/AST, CK, muscle-symptom-log, liver-symptom-log.

**Protocol takeaway:** Use as a safety boundary: avoid combining red yeast rice with cholesterol-lowering drugs or interaction-prone drugs without clinician review; monitor muscle and liver symptoms.

**Limitations:** Clinical reference page with summarized evidence and case reports; no standardized product or participant count is available.

**Population mismatch:** Cancer-center integrative medicine context may include medically complex patients and polypharmacy; this may overrepresent risk relative to healthy self-experimenters but is appropriate for safety boundaries.

**Claim use:** `safety-only`.
