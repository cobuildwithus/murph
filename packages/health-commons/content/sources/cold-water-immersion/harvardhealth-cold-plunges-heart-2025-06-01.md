---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:harvardhealth-cold-plunges-heart-2025-06-01
slug: sources/cold-water-immersion/harvardhealth-cold-plunges-heart-2025-06-01
title: 'Cold plunges: Healthy or harmful for your heart?'
summary: 'Cold plunges: Healthy or harmful for your heart? is an external public/protocol source for Cold Plunge; it is used for attribution, public expectation management, and safety boundaries rather than direct efficacy synthesis.'
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
  kind: web_page
  title: 'Cold plunges: Healthy or harmful for your heart?'
  authors: Julie Corliss; reviewed by Christopher P. Cannon
  year: 2025
  journal: Harvard Health Publishing
  url: https://www.health.harvard.edu/heart-health/cold-plunges-healthy-or-harmful-for-your-heart
  citation: 'Julie Corliss; reviewed by Christopher P. Cannon. Cold plunges: Healthy or harmful for your heart?. Harvard Health Publishing. June 1, 2025. https://www.health.harvard.edu/heart-health/cold-plunges-healthy-or-harmful-for-your-heart.'
sourceIdentity:
  identityKind: web_page
  canonicalIdBasis: url
  identifiers:
    titleHash: 1e215ad72b64c6c8e2c1e48109860bc7a623a548c53fa3c0bee7adda747130d0
    url: https://www.health.harvard.edu/heart-health/cold-plunges-healthy-or-harmful-for-your-heart
  canonicalUrl: https://www.health.harvard.edu/heart-health/cold-plunges-healthy-or-harmful-for-your-heart
  identityAliases:
  - 'Cold plunges: Healthy or harmful for your heart?'
  - Harvard Health Publishing (June 1, 2025)
  - https://www.health.harvard.edu/heart-health/cold-plunges-healthy-or-harmful-for-your-heart
researchEvidence:
  designKind: narrative_review
  designLabel: Consumer cardiovascular safety explainer
  populationLabel: General public, with emphasis on people with cardiovascular disease, rhythm abnormalities, peripheral artery disease, or Raynaud's disease.
  durationLabel: No direct follow-up; summarizes studies including chest-deep immersion and cold showers.
  cohortKey: cohort:harvardhealth-cold-plunges-heart-2025-06-01
  aggregateRole: context
  notes:
  - 'Intervention/exposure: Cold plunges / cold-water immersion and cold showers as discussed in recent reviews.'
  - 'Comparator/control: No original comparator; article summarizes selected review evidence and cardiovascular safety reasoning.'
  - 'Endpoints: heart rate; blood pressure; arrhythmia risk; stress; sleep quality; quality of life; immune function'
  - 'Effect direction: Reports that benefit evidence remains limited and that cardiovascular risk may outweigh unproven benefit for people with heart disease.'
  - 'Safety/adverse-event notes: Highlights adrenaline/norepinephrine-driven heart-rate and blood-pressure increases and cautions against use in people with cardiovascular disease or rhythm abnormalities.'
  - 'Limitations: Consumer article rather than original study.; Selected review discussion, not a formal extraction for Murph endpoints.; Does not provide new effect estimates.'
  - 'Population/directness caveat: Primarily public cardiovascular guidance; not a screened cold-plunge trial population.'
  - 'Directness to Cold Plunge: direct_protocol_safety_context'
  - 'Cold Plunge extraction context: bucket=External protocol/public-claims context; directness=general_guideline; claimUse=safety-only; priority=high'
sourceFindings:
- findingId: finding:harvardhealth-cold-plunges-heart-2025-06-01:limited-benefit-evidence
  sourceKey: source_artifact:harvardhealth-cold-plunges-heart-2025-06-01
  extractedFromArtifactId: art_harvardhealth_cold_plunges_heart_2025_06_01
  findingKind: context
  population: General public
  exposure: Cold plunges / cold-water immersion
  outcome: Strength of benefit evidence
  summary: The source summarizes the public evidence base as shallow, with only temporary or limited signals reported in reviews and little support for broad mood, immunity, or heart-health claims.
  evidenceUse:
  - context
- findingId: finding:harvardhealth-cold-plunges-heart-2025-06-01:cardiovascular-risk-boundary
  sourceKey: source_artifact:harvardhealth-cold-plunges-heart-2025-06-01
  extractedFromArtifactId: art_harvardhealth_cold_plunges_heart_2025_06_01
  findingKind: safety
  population: People with cardiovascular disease, rhythm abnormalities, peripheral artery disease, or Raynaud's disease
  exposure: Cold plunges / cold-water immersion
  outcome: Cardiovascular safety
  summary: The source warns that cold exposure can raise heart rate and blood pressure through stress-hormone responses and is not advisable for some people with cardiovascular disease, rhythm abnormalities, peripheral artery disease, or Raynaud's disease.
  evidenceUse:
  - safety
coldPlungeExtraction:
  batchId: batch-004
  evidenceBucket: External protocol/public-claims context
  directness: general_guideline
  claimUse: safety-only
  priority: high
  artifactRightsStatusGuess: permission_required
  identityResolutionStatus: new_source
aliases:
- 'Cold plunges: Healthy or harmful for your heart?'
- Harvard Health Publishing (June 1, 2025)
- https://www.health.harvard.edu/heart-health/cold-plunges-healthy-or-harmful-for-your-heart
---

This source is included for **External protocol/public-claims context**.

**Findings:** The source summarizes the public evidence base as shallow, with only temporary or limited signals reported in reviews and little support for broad mood, immunity, or heart-health claims. The source warns that cold exposure can raise heart rate and blood pressure through stress-hormone responses and is not advisable for some people with cardiovascular disease, rhythm abnormalities, peripheral artery disease, or Raynaud's disease.

**Why it matters:** Provides a high-credibility heart-safety boundary for users considering cold plunges and explicitly warns that evidence of benefit is shallow.

**Potential experiment signals:** blood pressure; heart rate; arrhythmia symptoms; stress; sleep quality; quality of life.

**Protocol takeaway:** Use to reinforce cardiovascular screening and to avoid claiming broad heart benefits from cold plunges.

**Claim use:** `safety-only`.

**Population mismatch:** Primarily public cardiovascular guidance; not a screened cold-plunge trial population.

**Limitations:** Consumer article rather than original study. Selected review discussion, not a formal extraction for Murph endpoints. Does not provide new effect estimates.

**Artifact and rights note:** This extraction stores metadata and a source page draft only. No copyrighted PDF or page copy is included in Git; preserve the canonical URL and verify rights before storing any downloadable copy.
