---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:pmcid-PMC3766664
slug: sources/cold-water-immersion/pmcid-PMC3766664
title: 'Cold-water immersion and other forms of cryotherapy: physiological changes potentially affecting recovery from high-intensity exercise'
summary: Mechanistic review of CWI and cryotherapy physiology potentially affecting high-intensity exercise recovery.
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
  kind: review
  title: 'Cold-water immersion and other forms of cryotherapy: physiological changes potentially affecting recovery from high-intensity exercise'
  authors: White GE; Wells GD
  year: 2013
  journal: Extreme Physiology & Medicine
  url: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC3766664/
  citation: 'White GE; Wells GD. Cold-water immersion and other forms of cryotherapy: physiological changes potentially affecting recovery from high-intensity exercise. Extreme Physiology & Medicine. 2013. PMCID: PMC3766664.'
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: pmcid
  identifiers:
    pmcid: PMC3766664
    titleHash: 53271bbdd2f47bc353ea2615cb12c1828b8a44b7733bc39e729a66caf85b5a0b
    url: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC3766664/
  canonicalUrl: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC3766664/
  identityAliases:
  - PMCID PMC3766664
  - 'Cold-water immersion and other forms of cryotherapy: physiological changes potentially affecting recovery from high-intensity exercise'
researchEvidence:
  designKind: narrative_review
  designLabel: Narrative review of cryotherapy physiology after high-intensity exercise
  populationLabel: Athletes and physically active adults discussed in high-intensity exercise recovery literature
  durationLabel: Not applicable; protocols vary across reviewed studies
  cohortKey: cohort:pmcid-pmc3766664
  aggregateRole: primary
  notes:
  - 'Intervention/exposure: Cold-water immersion and other cryotherapy modalities after high-intensity exercise'
  - 'Comparator/control: Mechanistic comparison across cryotherapy modalities and recovery literature'
  - 'Endpoints: thermoregulation; inflammation; muscle damage; performance recovery; recovery mechanisms'
  - 'Effect direction: The review summarizes physiological changes that could affect recovery from high-intensity exercise; it is mechanism/context rather than direct efficacy evidence.'
  - 'Safety/adverse-event notes: No source-level adverse-event extraction; safety relevance is mechanism and recovery boundary.'
  - 'Limitations: Narrative review design.; Includes multiple cryotherapy modalities, not only CWI.; High-intensity exercise recovery differs from wellness cold plunging.'
  - 'Population/directness caveat: Sports-recovery and high-intensity exercise context.'
  - 'Directness to Cold Plunge: adjacent_variant'
  - 'Cold Plunge extraction context: bucket=Sports recovery and training-adaptation boundary; directness=adjacent_variant; claimUse=context-only; priority=medium'
sourceFindings:
- findingId: finding:pmcid-pmc3766664:cryotherapy-mechanisms
  sourceKey: source_artifact:pmcid-PMC3766664
  extractedFromArtifactId: art_pmcid_pmc3766664
  findingKind: mechanistic
  population: Athletes and physically active adults in reviewed literature
  exposure: CWI and other cryotherapy after high-intensity exercise
  outcome: Physiological changes affecting recovery
  summary: The narrative review discusses thermoregulatory, inflammatory, and recovery mechanisms that could affect high-intensity exercise recovery.
  evidenceUse:
  - mechanism
  - context
- findingId: finding:pmcid-pmc3766664:review-directness-limit
  sourceKey: source_artifact:pmcid-PMC3766664
  extractedFromArtifactId: art_pmcid_pmc3766664
  findingKind: context
  population: Sports-recovery literature
  exposure: Multiple cryotherapy modalities
  outcome: Cold-plunge directness
  summary: Because the review is narrative and includes cryotherapy modalities beyond CWI, it should not carry direct cold-plunge efficacy claims.
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
- PMCID PMC3766664
- 'Cold-water immersion and other forms of cryotherapy: physiological changes potentially affecting recovery from high-intensity exercise'
- PMC3766664
---

This source is included for **Sports recovery and training-adaptation boundary**.

**Findings:** The narrative review discusses thermoregulatory, inflammatory, and recovery mechanisms that could affect high-intensity exercise recovery.; Because the review is narrative and includes cryotherapy modalities beyond CWI, it should not carry direct cold-plunge efficacy claims.

**Why it matters:** It supports explanation of why sports-recovery findings may not transfer cleanly to wellness protocols.

**Potential experiment signals:** thermoregulation; inflammation; muscle damage; performance recovery; recovery mechanisms.

**Protocol takeaway:** Use as mechanism background only; do not use as direct benefit evidence.

**Claim use:** `context-only`.

**Population mismatch:** Sports-recovery and high-intensity exercise context.

**Limitations:** Narrative review design.; Includes multiple cryotherapy modalities, not only CWI.; High-intensity exercise recovery differs from wellness cold plunging.

**Artifact and rights note:** PDF rights status is `open_access`. This extraction creates a source-page draft and metadata/artifact candidate only; no copyrighted PDF is included in Git.
