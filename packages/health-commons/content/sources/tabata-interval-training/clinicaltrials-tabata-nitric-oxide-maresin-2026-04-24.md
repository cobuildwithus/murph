---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-tabata-nitric-oxide-maresin-2026-04-24
slug: sources/tabata-interval-training/clinicaltrials-tabata-nitric-oxide-maresin-2026-04-24
title: Tabata Exercise on Nitric Oxide Synthases and Maresin
summary: ClinicalTrials.gov registry candidate for a mechanistic Tabata exercise study measuring nitric oxide synthase and Maresin biomarkers in smokers and non-smokers; included as current registry context only, with no peer-reviewed findings in this ledger.
status: draft
quality: usable
aliases:
  - NCT07412639
  - Tabata nitric oxide synthases maresin
categories:
  - tabata-interval-training
relations:
  -
    type: related_protocol
    target: protocol_variant:tabata-interval-training/tabata-20-10-interval-training
  -
    type: parent_family
    target: experiment_family:tabata-interval-training
sourceIdentity:
  identityKind: trial_registry
  canonicalIdBasis: url
  identifiers:
    url: https://clinicaltrials.gov/study/NCT07412639
  canonicalUrl: https://clinicaltrials.gov/study/NCT07412639
sourceKind: trial_registry
source:
  kind: other
  title: Tabata Exercise on Nitric Oxide Synthases and Maresin
  authors: Ataturk University / ClinicalTrials.gov record
  year: 2026
  journal: ClinicalTrials.gov
  url: https://clinicaltrials.gov/study/NCT07412639
  citation: ClinicalTrials.gov. Tabata Exercise on Nitric Oxide Synthases and Maresin. NCT07412639. Accessed April 24, 2026. https://clinicaltrials.gov/study/NCT07412639.
researchEvidence:
  designKind: other
  designLabel: ClinicalTrials.gov registry candidate for mechanistic exercise study
  populationLabel: Adults age 18 to 40; smoker and non-smoker comparison context
  durationLabel: Duration not extracted in this batch
  cohortKey: clinicaltrials-tabata-nitric-oxide-maresin-2026-04-24
  aggregateRole: context
protocolEvidence:
  -
    protocolKey: protocol_variant:tabata-interval-training/tabata-20-10-interval-training
    groupId: clinicaltrials-tabata-nitric-oxide-maresin-2026-04-24
    stance: context_only
    scope: adjacent_variant
    result: not_efficacy_evidence
    endpointKeys: []
    headline: Registry candidate for mechanistic Tabata biomarker work, without extracted results.
    implication: Useful as a watchlist item for nitric-oxide and inflammation-resolution biomarkers.
    caveat: No peer-reviewed results or posted effects are available in this batch; do not cite for biomarker effects.
    displayPriority: 85
evidenceBucket: trial_registry_context
whyItMatters: It flags an emerging mechanistic research direction but supplies no usable effect estimates yet.
potentialMurphEndpoints:
  - iNOS
  - eNOS
  - Maresin
  - smoking status
  - mechanistic biomarker response
protocolTakeaway: Watchlist only; do not claim Tabata changes nitric oxide synthase or Maresin until results are extracted from a posted report or publication.
murphTakeaway: Use as low-priority registry context for future mechanistic endpoints.
studyDesign: ClinicalTrials.gov registry candidate; detailed design and results not extracted in this batch.
modality: Tabata exercise mechanistic biomarker study
directness: adjacent_variant
claimUse: context-only
murphV1Priority: Low
pdfRightsStatus: unknown
sourceExtractionBatch: 12-source-extraction-009
---
This source is included for **trial_registry_context**.

**Findings:**
- The registry candidate is framed around Tabata exercise effects on nitric oxide synthase and Maresin biomarkers, including smoker and non-smoker context.
- No posted or peer-reviewed findings are extracted in this batch.

**Why it matters:** It flags an emerging mechanistic research direction but supplies no usable effect estimates yet.

**Potential experiment signals:** iNOS, eNOS, Maresin, smoking status, mechanistic biomarker response.

**Protocol takeaway:** Watchlist only; do not claim Tabata changes nitric oxide synthase or Maresin until results are extracted from a posted report or publication.

**Limitations and boundaries:**
- No sample size, duration, comparator details, effect estimates, or adverse events were extracted in this batch.
- Registry candidate should not support mechanistic claims until results are available.
- Population and smoking-status context may not generalize to routine recreational Tabata users.

**Claim use:** `context-only`.
