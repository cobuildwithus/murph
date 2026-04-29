---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:clinicaltrials-nct00639223-2026-04-26"
slug: "sources/red-yeast-rice/clinicaltrials-nct00639223-2026-04-26"
title: "Safety of Red Yeast Rice for High Cholesterol in Individuals With Statin Intolerance"
summary: "ClinicalTrials.gov registry/results record for RYR versus pravastatin tolerability in statin-intolerant patients."
status: "draft"
quality: "usable"
aliases:
  - "NCT00639223"
  - "Red Yeast Rice vs Pravastatin tolerability study"
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
  kind: "other"
  title: "Safety of Red Yeast Rice for High Cholesterol in Individuals With Statin Intolerance"
  authors: "ClinicalTrials.gov; University of Pennsylvania"
  year: 2026
  journal: "ClinicalTrials.gov"
  citation: "ClinicalTrials.gov. Safety of Red Yeast Rice for High Cholesterol in Individuals With Statin Intolerance. NCT00639223. Snapshot source key dated 2026-04-26."
  url: "https://clinicaltrials.gov/study/NCT00639223"
sourceIdentity:
  identityKind: "trial_registry"
  canonicalIdBasis: "registry_id"
  identifiers:
    registryId: "NCT00639223"
    titleHash: "7c8c76478bec3f63cb643bac16e543fee691476314b0fc64428e4154cb6ac48f"
    url: "https://clinicaltrials.gov/study/NCT00639223"
  canonicalUrl: "https://clinicaltrials.gov/study/NCT00639223"
researchEvidence:
  designKind: "randomized_controlled_trial"
  designLabel: "Completed randomized active-comparator safety registry"
  participantCount: 43
  participantCountKind: "reported"
  populationLabel: "Individuals with high cholesterol and previous statin intolerance."
  durationLabel: "12 weeks"
  aggregateRole: "context"
  cohortKey: "clinicaltrials-nct00639223-2026-04-26"
evidenceBucket: "Direct trial registry and future evidence watchlist"
whyItMatters: "Adds registry-level adverse-event and LDL-C percent-change details for the active-comparator statin-intolerance trial."
potentialMurphEndpoints:
  - "myalgia withdrawal"
  - "CK"
  - "LDL-C percent change"
  - "adverse events"
protocolTakeaway: "Use as registry provenance and safety context, not independent efficacy evidence."
murphTakeaway: "Helpful for symptom/CK monitoring and duplicate-control with PMID 20102918."
studyDesign: "Trial registry for RYR versus pravastatin tolerability study"
modality: "Trial registry record"
claimUse: "context-only"
directness: "clinical_supervised_registry"
interventionOrExposure: "Red yeast rice four 600 mg capsules twice daily for 12 weeks."
comparatorOrControl: "Pravastatin 20 mg twice daily for 12 weeks."
durationOrFollowUp: "12 weeks"
endpoints:
  - "myalgia withdrawal"
  - "CK"
  - "LDL-C percent change"
  - "adverse events"
effectEstimatesOrDirection: "Registry-linked extraction reports LDL-C percent change of -30.2% ±10.5 with RYR and -27.0% ±15.4 with pravastatin."
adverseEventsOrSafetyNotes: "Withdrawal due to muscle symptoms/CK >500 was 1/21 with RYR and 2/22 with pravastatin; no serious adverse events were reported in accessible extraction notes."
limitations: "Registry result duplicates/contextualizes the published Halbert 2010 trial; active comparator, no placebo."
populationMismatch: "Statin-intolerant population; safety context only for general users."
sourceFindings:

  -
    findingId: "finding:clinicaltrials-nct00639223-2026-04-26-registry-results"
    sourceKey: "source_artifact:clinicaltrials-nct00639223-2026-04-26"
    findingKind: "context"
    population: "Individuals with high cholesterol and previous statin intolerance."
    exposure: "Red yeast rice four 600 mg capsules twice daily for 12 weeks."
    outcome: "LDL-C and myalgia/CK registry outcomes"
    summary: "NCT00639223 reports RYR four 600 mg capsules twice daily versus pravastatin 20 mg twice daily for 12 weeks, with LDL-C percent changes of -30.2% ±10.5 and -27.0% ±15.4, respectively, and withdrawal due to myalgia/CK >500 in 1/21 RYR and 2/22 pravastatin participants."
    evidenceUse:
      - "context"
      - "safety"
      - "efficacy"
  -
    findingId: "finding:clinicaltrials-nct00639223-2026-04-26-duplicate-context"
    sourceKey: "source_artifact:clinicaltrials-nct00639223-2026-04-26"
    findingKind: "context"
    population: "Individuals with high cholesterol and previous statin intolerance."
    exposure: "Red yeast rice four 600 mg capsules twice daily for 12 weeks."
    outcome: "Duplicate published source boundary"
    summary: "The registry contextualizes the published Halbert 2010 trial and should not be counted independently."
    evidenceUse:
      - "context"
murphV1Priority: "Low"
pdfRightsStatus: "open_access"
---
This source is included for **Direct trial registry and future evidence watchlist**.

**Findings:** Registry-linked extraction reports LDL-C percent change of -30.2% ±10.5 with RYR and -27.0% ±15.4 with pravastatin. Withdrawal due to muscle symptoms/CK >500 was 1/21 with RYR and 2/22 with pravastatin; no serious adverse events were reported in accessible extraction notes.

**Why it matters:** Adds registry-level adverse-event and LDL-C percent-change details for the active-comparator statin-intolerance trial.

**Potential experiment signals:** myalgia withdrawal, CK, LDL-C percent change, adverse events.

**Protocol takeaway:** Use as registry provenance and safety context, not independent efficacy evidence.

**Claim use:** `context-only`.

**Directness and boundary:** clinical_supervised_registry. Registry result duplicates/contextualizes the published Halbert 2010 trial; active comparator, no placebo. Population mismatch: Statin-intolerant population; safety context only for general users.
