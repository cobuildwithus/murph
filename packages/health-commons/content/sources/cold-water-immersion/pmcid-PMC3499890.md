---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:pmcid-PMC3499890
slug: sources/cold-water-immersion/pmcid-PMC3499890
title: 'Interleukin-6 Responses to Water Immersion Therapy After Acute Exercise Heat Stress: A Pilot Investigation'
summary: Adjacent pilot source on IL-6 after water immersion and exercise heat stress; context-only for inflammation mechanisms.
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
  kind: journal_article
  title: 'Interleukin-6 Responses to Water Immersion Therapy After Acute Exercise Heat Stress: A Pilot Investigation'
  authors: Lee EC; Watson G; Casa DJ; Armstrong LE; Kraemer WJ; Vingren JL; Spiering BA; Maresh CM
  year: 2012
  journal: Journal of Athletic Training
  url: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC3499890/
  citation: 'Lee EC; Watson G; Casa DJ; Armstrong LE; Kraemer WJ; Vingren JL; Spiering BA; Maresh CM. Interleukin-6 Responses to Water Immersion Therapy After Acute Exercise Heat Stress: A Pilot Investigation. Journal of Athletic Training. 2012. PMCID: PMC3499890.'
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: pmcid
  identifiers:
    pmcid: PMC3499890
    titleHash: 3b0e47891f10834e42eb063ac3480d0a4454bab497773146ccf14772a6063572
    url: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC3499890/
  canonicalUrl: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC3499890/
  identityAliases:
  - PMCID PMC3499890
  - 'Interleukin-6 Responses to Water Immersion Therapy After Acute Exercise Heat Stress: A Pilot Investigation'
researchEvidence:
  designKind: acute_mechanistic
  designLabel: Pilot randomized water-immersion physiology study after exercise heat stress
  populationLabel: Participants after acute exercise heat stress
  durationLabel: Post-exercise water-bath recovery; exact duration not verified in accessible extract
  cohortKey: cohort:pmcid-pmc3499890
  aggregateRole: primary
  notes:
  - 'Intervention/exposure: Cold or warm water immersion therapy after exercise heat stress; accessible metadata identifies cold water near 11.7 °C'
  - 'Comparator/control: Warm water-bath condition and/or between-condition recovery comparison, according to accessible metadata'
  - 'Endpoints: interleukin-6; inflammation; heat stress recovery; water-bath recovery'
  - 'Effect direction: The source examined IL-6 responses to water immersion after exercise heat stress; detailed effect estimates were not extracted from accessible metadata.'
  - 'Safety/adverse-event notes: No adverse-event signal was extracted from accessible metadata.'
  - 'Limitations: Pilot study.; Heat-stress context limits transfer to cold-plunge wellness use.; Full effect estimates and sample size were not extracted.'
  - 'Population/directness caveat: Exercise heat-stress recovery population, not resting cold-plunge users.'
  - 'Directness to Cold Plunge: adjacent_variant'
  - 'Cold Plunge extraction context: bucket=Sports recovery and training-adaptation boundary; directness=adjacent_variant; claimUse=context-only; priority=medium'
sourceFindings:
- findingId: finding:pmcid-pmc3499890:heat-stress-il6
  sourceKey: source_artifact:pmcid-PMC3499890
  extractedFromArtifactId: art_pmcid_pmc3499890
  findingKind: mechanistic
  population: Participants after acute exercise heat stress
  exposure: Water immersion therapy including cold water after heat-stress exercise
  outcome: Interleukin-6 response
  summary: The pilot study examined IL-6 responses to water immersion therapy after acute exercise heat stress, making it inflammation-mechanism context rather than direct cold-plunge efficacy evidence.
  evidenceUse:
  - mechanism
  - context
- findingId: finding:pmcid-pmc3499890:heat-stress-mismatch
  sourceKey: source_artifact:pmcid-PMC3499890
  extractedFromArtifactId: art_pmcid_pmc3499890
  findingKind: context
  population: Exercise heat-stress participants
  exposure: Post-exercise water-bath therapy
  outcome: Cold-plunge directness
  summary: The heat-stress and recovery setting differs substantially from resting or wellness cold-plunge protocols.
  evidenceUse:
  - context
coldPlungeExtraction:
  batchId: batch-009
  evidenceBucket: Sports recovery and training-adaptation boundary
  directness: adjacent_variant
  claimUse: context-only
  priority: medium
  artifactRightsStatusGuess: open_access
  identityResolutionStatus: new_source
aliases:
- PMCID PMC3499890
- 'Interleukin-6 Responses to Water Immersion Therapy After Acute Exercise Heat Stress: A Pilot Investigation'
- PMC3499890
---

This source is included for **Sports recovery and training-adaptation boundary**.

**Findings:** The pilot study examined IL-6 responses to water immersion therapy after acute exercise heat stress, making it inflammation-mechanism context rather than direct cold-plunge efficacy evidence.; The heat-stress and recovery setting differs substantially from resting or wellness cold-plunge protocols.

**Why it matters:** It helps separate immune/inflammation mechanism evidence from direct cold-plunge benefit claims.

**Potential experiment signals:** interleukin-6; inflammation; heat stress recovery; water-bath recovery.

**Protocol takeaway:** Do not use to claim cold plunges improve immune function; treat as heat-stress recovery physiology context.

**Claim use:** `context-only`.

**Population mismatch:** Exercise heat-stress recovery population, not resting cold-plunge users.

**Limitations:** Pilot study.; Heat-stress context limits transfer to cold-plunge wellness use.; Full effect estimates and sample size were not extracted.

**Artifact and rights note:** PDF rights status is `open_access`. This extraction creates a source-page draft and metadata/artifact candidate only; no copyrighted PDF is included in Git.
