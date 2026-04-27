---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:clinicaltrials-nct00405769-2026-04-26"
slug: "sources/red-yeast-rice/clinicaltrials-nct00405769-2026-04-26"
title: "Lipid Lowering in Patients With Statin Intolerance"
summary: "ClinicalTrials.gov registry for the statin-intolerant RYR placebo-controlled trial later published as Becker 2009."
status: "draft"
quality: "usable"
aliases:
  - "NCT00405769"
  - "Alternative Lipid Lowering in Patients With Statin Intolerance"
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
  title: "Lipid Lowering in Patients With Statin Intolerance"
  authors: "ClinicalTrials.gov; Chestnut Hill Health System"
  year: 2026
  journal: "ClinicalTrials.gov"
  citation: "ClinicalTrials.gov. Lipid Lowering in Patients With Statin Intolerance. NCT00405769. Snapshot source key dated 2026-04-26."
  url: "https://clinicaltrials.gov/study/NCT00405769"
sourceIdentity:
  identityKind: "trial_registry"
  canonicalIdBasis: "registry_id"
  identifiers:
    registryId: "NCT00405769"
    titleHash: "b12e3a53c9540b1f18b12b4926c4934f517fb220f2ca827c5abd3b94f2ff9a53"
    url: "https://clinicaltrials.gov/study/NCT00405769"
  canonicalUrl: "https://clinicaltrials.gov/study/NCT00405769"
researchEvidence:
  designKind: "randomized_controlled_trial"
  designLabel: "Completed randomized placebo-controlled trial registry"
  participantCount: 64
  participantCountKind: "reported"
  populationLabel: "Patients with statin intolerance and dyslipidemia."
  durationLabel: "24 weeks"
  aggregateRole: "context"
  cohortKey: "clinicaltrials-nct00405769-2026-04-26"
evidenceBucket: "Direct trial registry and future evidence watchlist"
whyItMatters: "Confirms design, dose schedule, endpoints, masking, and enrollment context for the published statin-intolerance RCT."
potentialMurphEndpoints:
  - "LDL-C"
  - "HDL-C"
  - "triglycerides"
  - "total cholesterol"
  - "CRP"
  - "CPK"
  - "liver function"
protocolTakeaway: "Use for provenance and endpoint confirmation, not as an independent result source."
murphTakeaway: "Helps specify lab-monitoring endpoints and avoid duplicate counting with PMID 19528562."
studyDesign: "Trial registry for randomized placebo-controlled RYR study"
modality: "Trial registry record"
claimUse: "context-only"
directness: "direct_protocol_registry"
interventionOrExposure: "RYR 600 mg, three capsules twice daily, plus therapeutic lifestyle change."
comparatorOrControl: "Placebo capsules plus therapeutic lifestyle change."
durationOrFollowUp: "24 weeks"
endpoints:
  - "LDL-C"
  - "HDL-C"
  - "triglycerides"
  - "total cholesterol"
  - "CRP"
  - "CPK"
  - "liver function"
effectEstimatesOrDirection: "Registry design/results context linked to the published Becker 2009 trial; do not treat as independent efficacy evidence."
adverseEventsOrSafetyNotes: "Registry lists CPK and liver function outcomes for safety monitoring."
limitations: "Trial registry record duplicates/contextualizes the published trial and should not be double-counted."
populationMismatch: "Statin-intolerant clinical trial population."
sourceFindings:
  -
    findingId: "finding:clinicaltrials-nct00405769-2026-04-26-registry-design"
    sourceKey: "source_artifact:clinicaltrials-nct00405769-2026-04-26"
    findingKind: "context"
    population: "Patients with statin intolerance and dyslipidemia."
    exposure: "RYR 600 mg, three capsules twice daily, plus therapeutic lifestyle change."
    outcome: "Trial design and endpoints"
    summary: "NCT00405769 describes a completed randomized placebo-controlled trial of RYR 600 mg three capsules twice daily plus lifestyle intervention versus placebo for 24 weeks, with LDL-C, HDL-C, triglycerides, total cholesterol, CRP, CPK, and liver-function endpoints."
    evidenceUse:
      - "context"
      - "measurement"
  -
    findingId: "finding:clinicaltrials-nct00405769-2026-04-26-duplicate-context"
    sourceKey: "source_artifact:clinicaltrials-nct00405769-2026-04-26"
    findingKind: "context"
    population: "Patients with statin intolerance and dyslipidemia."
    exposure: "RYR 600 mg, three capsules twice daily, plus therapeutic lifestyle change."
    outcome: "Duplicate published source boundary"
    summary: "The registry contextualizes the published Becker 2009 statin-intolerant RCT and should not be counted as an independent clinical result."
    evidenceUse:
      - "context"
murphV1Priority: "Low"
pdfRightsStatus: "open_access"
---
This source is included for **Direct trial registry and future evidence watchlist**.

**Findings:** Registry design/results context linked to the published Becker 2009 trial; do not treat as independent efficacy evidence. Registry lists CPK and liver function outcomes for safety monitoring.

**Why it matters:** Confirms design, dose schedule, endpoints, masking, and enrollment context for the published statin-intolerance RCT.

**Potential experiment signals:** LDL-C, HDL-C, triglycerides, total cholesterol, CRP, CPK, liver function.

**Protocol takeaway:** Use for provenance and endpoint confirmation, not as an independent result source.

**Claim use:** `context-only`.

**Directness and boundary:** direct_protocol_registry. Trial registry record duplicates/contextualizes the published trial and should not be double-counted. Population mismatch: Statin-intolerant clinical trial population.
