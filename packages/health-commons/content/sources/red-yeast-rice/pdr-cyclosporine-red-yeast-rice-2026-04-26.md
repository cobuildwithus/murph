---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:pdr-cyclosporine-red-yeast-rice-2026-04-26"
slug: "sources/red-yeast-rice/pdr-cyclosporine-red-yeast-rice-2026-04-26"
title: "Sandimmune (cyclosporine) Drug Summary"
summary: "PDR drug-interaction reference identifying red yeast rice as contraindicated with cyclosporine because cyclosporine increases myopathy risk with HMG-CoA reductase inhibitor-like exposures."
status: "draft"
quality: "usable"
aliases:
  - "PDR cyclosporine red yeast rice interaction"
  - "Sandimmune cyclosporine red yeast rice"
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
  title: "Sandimmune (cyclosporine) Drug Summary"
  authors: "Physicians’ Desk Reference (PDR)"
  year: 2026
  journal: "PDR.net Drug Summary"
  citation: "PDR.net. Sandimmune (cyclosporine) Drug Summary. Accessed April 26, 2026."
  url: "https://www.pdr.net/drug-summary/?drugLabelId=Sandimmune-cyclosporine-2484"
sourceIdentity:
  identityKind: "web_page"
  canonicalIdBasis: "url"
  identifiers:
    titleHash: "f7036aaf367e7e7f7066ff7116c1f6cc25343ef4e37e81e20d8d19f48d7939a0"
    url: "https://www.pdr.net/drug-summary/?drugLabelId=Sandimmune-cyclosporine-2484"
  canonicalUrl: "https://www.pdr.net/drug-summary/?drugLabelId=Sandimmune-cyclosporine-2484"
researchEvidence:
  designKind: "other"
  designLabel: "Drug-interaction reference"
  populationLabel: "People receiving cyclosporine, including transplant or immunosuppressed patients"
  durationLabel: "Not applicable; drug-interaction reference"
  aggregateRole: "context"
  cohortKey: "pdr-cyclosporine-red-yeast-rice-interaction"
  notes:
    - "No participant count is reported for this drug-interaction reference."
evidenceBucket: "Interactions, contraindications, and population boundaries"
whyItMatters: "Provides a high-specificity contraindication for a medication class that can increase serious myopathy risk with statin-like compounds."
potentialMurphEndpoints:
  - "cyclosporine-medication-screen"
  - "myopathy-risk-screen"
  - "CK"
  - "muscle-pain-log"
  - "urgent-clinician-review"
protocolTakeaway: "Treat current cyclosporine use as a contraindication or hard clinician-review boundary for red yeast rice experimentation."
murphTakeaway: "This source is safety-only and should be used as an onboarding exclusion/stop-rule input, not as an efficacy source."
studyDesign: "Drug-interaction reference"
modality: "Cyclosporine with red yeast rice / HMG-CoA reductase inhibitor-like exposure"
directness: "same_mechanism"
claimUse: "safety-only"
sourceFindings:

  -
    findingId: "finding:pdr-cyclosporine-ryr-contraindicated"
    findingKind: "safety"
    population: "Patients currently taking cyclosporine"
    exposure: "Cyclosporine plus red yeast rice"
    outcome: "Contraindicated combination due to increased myopathy risk"
    summary: "PDR lists red yeast rice as contraindicated with cyclosporine and advises avoiding red yeast rice in patients currently taking cyclosporine because cyclosporine can increase myopathy risk with HMG-CoA reductase inhibitor-like agents."
    evidenceUse:
      - "safety"
    sourceKey: "source_artifact:pdr-cyclosporine-red-yeast-rice-2026-04-26"
murphV1Priority: "High"
pdfRightsStatus: "unknown"
---
This source is included for **Interactions, contraindications, and population boundaries**.

**Findings:**
- `finding:pdr-cyclosporine-ryr-contraindicated` — PDR lists red yeast rice as contraindicated with cyclosporine and advises avoiding red yeast rice in patients currently taking cyclosporine because cyclosporine can increase myopathy risk with HMG-CoA reductase inhibitor-like agents.

**Why it matters:** Provides a high-specificity contraindication for a medication class that can increase serious myopathy risk with statin-like compounds.

**Potential experiment signals:** cyclosporine-medication-screen, myopathy-risk-screen, CK, muscle-pain-log, urgent-clinician-review.

**Protocol takeaway:** Treat current cyclosporine use as a contraindication or hard clinician-review boundary for red yeast rice experimentation.

**Limitations:** Drug-interaction reference; not a red yeast rice clinical outcome study and does not estimate event incidence.

**Population mismatch:** Cyclosporine users are medically higher-risk than the average cholesterol self-experimenter; this mismatch strengthens the need for exclusion rather than protocol generalization.

**Claim use:** `safety-only`.
