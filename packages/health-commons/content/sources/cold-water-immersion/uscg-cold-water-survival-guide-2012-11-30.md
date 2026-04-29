---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:uscg-cold-water-survival-guide-2012-11-30
slug: sources/cold-water-immersion/uscg-cold-water-survival-guide-2012-11-30
title: A Pocket Guide to Cold Water Survival
summary: Pocket guide to cold-water survival distributed by the United States Coast Guard/IMO.
status: draft
quality: usable
categories:
- cold-water-immersion
- cold-plunge
relations:
- type: parent_family
  target: experiment_family:cold-water-immersion
- type: related_protocol
  target: protocol_variant:cold-water-immersion/cold-plunge
source:
  kind: guideline
  title: A Pocket Guide to Cold Water Survival
  authors: International Maritime Organization; United States Coast Guard distribution
  year: 2012
  journal: United States Coast Guard / International Maritime Organization
  url: https://www.dco.uscg.mil/Portals/9/DCO%20Documents/5p/5ps/NVIC/2012/NVIC%2007-12%20Pocket%20Guide%20to%20Cold%20Water%20Survival.pdf
  citation: International Maritime Organization; United States Coast Guard distribution. A Pocket Guide to Cold Water Survival. United States Coast Guard / International Maritime Organization. 2012. https://www.dco.uscg.mil/Portals/9/DCO%20Documents/5p/5ps/NVIC/2012/NVIC%2007-12%20Pocket%20Guide%20to%20Cold%20Water%20Survival.pdf
sourceIdentity:
  identityKind: guideline
  canonicalIdBasis: url
  identifiers:
    titleHash: 3583b2eeed6b1dbb18a1ecaf1ddd7683a9764827aa6e6fd131187cc9e1a57367
    url: https://www.dco.uscg.mil/Portals/9/DCO%20Documents/5p/5ps/NVIC/2012/NVIC%2007-12%20Pocket%20Guide%20to%20Cold%20Water%20Survival.pdf
  canonicalUrl: https://www.dco.uscg.mil/Portals/9/DCO%20Documents/5p/5ps/NVIC/2012/NVIC%2007-12%20Pocket%20Guide%20to%20Cold%20Water%20Survival.pdf
  identityAliases:
  - International Maritime Organization 2012
  - A Pocket Guide to Cold Water Survival
researchEvidence:
  designKind: guideline
  designLabel: Cold-water survival guide for maritime accidental immersion
  populationLabel: Seafarers and people at risk of accidental cold-water immersion
  durationLabel: Survival guide covering stages from cold shock through post-rescue collapse
  cohortKey: cohort:uscg-cold-water-survival-guide-2012-11-30
  aggregateRole: synthesis
  notes:
  - Generated source-index.json was absent from the supplied snapshot; resolved against canonical ledger and local candidate records only.
  - 'Canonical ledger note: Candidate shards: 10-discovery-external-protocol-claims; raw candidate rows merged: 1. Candidate IDs: candidate:external-protocol-claims:021. Generated source-index.json was absent from supplied snapshot; no existing cold-water source inventory was available, so this is a provisional new-source resolution pending generated-index check. Safety-only: use for screens, stop rules, contraindications, or adverse-event context, not benefit claims.'
  - 'Cold Plunge extraction context: bucket=Safety, adverse events, and cold-shock boundaries; directness=general_guideline; claimUse=safety-only; priority=high'
sourceFindings:
- findingId: finding:uscg-cold-water-survival-guide-2012-11-30:cold-water-survival-stages
  sourceKey: source_artifact:uscg-cold-water-survival-guide-2012-11-30
  extractedFromArtifactId: art_uscg_cold_water_survival_guide_2012_11_30
  findingKind: safety
  population: Seafarers and people at risk of accidental cold-water immersion
  exposure: Cold-water survival education and risk-reduction guidance
  outcome: cold shock; swimming failure/incapacitation; hypothermia; post-rescue collapse
  summary: The pocket guide describes cold-water survival hazards including cold shock, short-term swimming failure/incapacitation, hypothermia, and post-rescue collapse. It is adjacent survival guidance, not cold-plunge efficacy evidence.
  evidenceUse:
  - safety
  - context
coldPlungeExtraction:
  batchId: batch-005
  evidenceBucket: Safety, adverse events, and cold-shock boundaries
  directness: general_guideline
  claimUse: safety-only
  priority: high
  artifactRightsStatusGuess: open_access
  identityResolutionStatus: new_source
aliases:
- International Maritime Organization 2012
- A Pocket Guide to Cold Water Survival
---

This source is included for **Safety, adverse events, and cold-shock boundaries**.

**Findings:** The pocket guide describes cold-water survival hazards including cold shock, short-term swimming failure/incapacitation, hypothermia, and post-rescue collapse. It is adjacent survival guidance, not cold-plunge efficacy evidence.

**Why it matters:** Useful public-safety context for cold-water hazard staging and avoiding open-water overconfidence.

**Potential experiment signals:** cold-shock symptoms, swimming failure, hypothermia symptoms, post-rescue symptoms.

**Protocol takeaway:** Use as adjacent survival safety context, especially to distinguish cold plunge from accidental/open-water immersion.

**Claim use:** `safety-only`.

## Extraction notes

- Directness to Cold Plunge: `general_guideline`.
- Population mismatch: Seafarers in accidental cold water differ from controlled plunge users, but the cold-shock staging is relevant for safety education.
- Limitations: Maritime accidental-immersion guidance, not consumer cold-plunge evidence.; Survival context may involve clothing, waves, fatigue, and rescue delay.
- Artifact rights: `open_access`. No copyrighted PDF is included in Git; this draft records metadata and candidate artifact information only.
