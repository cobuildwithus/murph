---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:researchgate-cholestin-americans-2013-01-01"
slug: "sources/red-yeast-rice/researchgate-cholestin-americans-2013-01-01"
title: "The cholesterol-lowering effect and rebound after withdraw of RYR Cholestin in American subjects with moderate hypercholesterolemia: a multi-center, self-pairing study"
summary: "Metadata-only record for an American Cholestin self-pairing study with withdrawal/rebound framing."
status: "draft"
quality: "usable"
aliases:
  - "RYR Cholestin American self-pairing study metadata"
  - "Lu 2013 Cholestin withdrawal rebound ResearchGate metadata"
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
  title: "The cholesterol-lowering effect and rebound after withdraw of RYR Cholestin in American subjects with moderate hypercholesterolemia: a multi-center, self-pairing study"
  authors: "J.H. Lu et al."
  year: 2013
  journal: "ResearchGate-indexed manuscript metadata"
  citation: "Lu JH, et al. The cholesterol-lowering effect and rebound after withdraw of RYR Cholestin in American subjects with moderate hypercholesterolemia: a multi-center, self-pairing study. ResearchGate metadata page. 2013."
  url: "https://www.researchgate.net/publication/280735066_The_cholesterol-lowering_effect_and_Rebound_after_withdraw_of_RYR_Cholestin_in_American_subjects_with_moderate_hypercholesterolemia_A_multi-center_self-pairing_study"
sourceIdentity:
  identityKind: "web_page"
  canonicalIdBasis: "url"
  identifiers:
    titleHash: "38e58e760e948e33c2f3a2fe411a1954148177ab06bdc7da5692e8af1eb3d42b"
    url: "https://www.researchgate.net/publication/280735066_The_cholesterol-lowering_effect_and_Rebound_after_withdraw_of_RYR_Cholestin_in_American_subjects_with_moderate_hypercholesterolemia_A_multi-center_self-pairing_study"
  canonicalUrl: "https://www.researchgate.net/publication/280735066_The_cholesterol-lowering_effect_and_Rebound_after_withdraw_of_RYR_Cholestin_in_American_subjects_with_moderate_hypercholesterolemia_A_multi-center_self-pairing_study"
researchEvidence:
  designKind: "single_arm_trial"
  designLabel: "Multicenter self-pairing study metadata"
  populationLabel: "American subjects with moderate hypercholesterolemia."
  durationLabel: "Duration not extracted from metadata-only source"
  aggregateRole: "context"
  cohortKey: "researchgate-cholestin-americans-2013-01-01"
evidenceBucket: "Direct protocol and dose evidence"
whyItMatters: "Potentially relevant to discontinuation/rebound questions, but only as a retrieval lead until full data are available."
potentialMurphEndpoints:
  - "cholesterol lowering"
  - "rebound after withdrawal"
protocolTakeaway: "Do not use for effect claims; keep as a source-recall lead for future extraction."
murphTakeaway: "May inform a future stop/rebound design only after full manuscript verification."
studyDesign: "Multi-center self-pairing study metadata"
modality: "ResearchGate metadata lead"
claimUse: "context-only"
directness: "direct_protocol_metadata_only"
interventionOrExposure: "RYR Cholestin with withdrawal/rebound observation."
comparatorOrControl: "Self-paired baseline and withdrawal periods; no randomized placebo comparator extracted."
durationOrFollowUp: "Duration not extracted from metadata-only source"
endpoints:
  - "cholesterol lowering"
  - "rebound after withdrawal"
effectEstimatesOrDirection: "Metadata title indicates cholesterol-lowering and rebound-after-withdrawal outcomes, but no effect sizes or denominators were extracted."
adverseEventsOrSafetyNotes: "No adverse-event information extracted from metadata-only source."
limitations: "ResearchGate metadata-only source with no DOI/PMID/PMCID extracted; full manuscript access and rights unclear."
populationMismatch: "Moderate hypercholesterolemia and proprietary Cholestin product; context-only until full source is verified."
sourceFindings:
  -
    findingId: "finding:researchgate-cholestin-americans-2013-01-01-metadata-lead"
    sourceKey: "source_artifact:researchgate-cholestin-americans-2013-01-01"
    findingKind: "context"
    population: "American subjects with moderate hypercholesterolemia."
    exposure: "RYR Cholestin with withdrawal/rebound observation."
    outcome: "Potential cholesterol lowering and withdrawal rebound study"
    summary: "ResearchGate metadata describes a multicenter self-pairing study of RYR Cholestin in American subjects with moderate hypercholesterolemia and rebound after withdrawal, but no effect sizes, denominators, or adverse events were extracted."
    evidenceUse:
      - "context"
  -
    findingId: "finding:researchgate-cholestin-americans-2013-01-01-rights-boundary"
    sourceKey: "source_artifact:researchgate-cholestin-americans-2013-01-01"
    findingKind: "context"
    population: "American subjects with moderate hypercholesterolemia."
    exposure: "RYR Cholestin with withdrawal/rebound observation."
    outcome: "Access and rights boundary"
    summary: "The source is a metadata lead without DOI/PMID/PMCID in this batch, and copyrighted full text should not be committed without rights verification."
    evidenceUse:
      - "context"
murphV1Priority: "Low"
pdfRightsStatus: "permission_required"
---
This source is included for **Direct protocol and dose evidence**.

**Findings:** Metadata title indicates cholesterol-lowering and rebound-after-withdrawal outcomes, but no effect sizes or denominators were extracted. No adverse-event information extracted from metadata-only source.

**Why it matters:** Potentially relevant to discontinuation/rebound questions, but only as a retrieval lead until full data are available.

**Potential experiment signals:** cholesterol lowering, rebound after withdrawal.

**Protocol takeaway:** Do not use for effect claims; keep as a source-recall lead for future extraction.

**Claim use:** `context-only`.

**Directness and boundary:** direct_protocol_metadata_only. ResearchGate metadata-only source with no DOI/PMID/PMCID extracted; full manuscript access and rights unclear. Population mismatch: Moderate hypercholesterolemia and proprietary Cholestin product; context-only until full source is verified.
