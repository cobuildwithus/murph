---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:lungorg-sauna-cold-plunges-health-impacts-2025-05-29
slug: sources/cold-water-immersion/lungorg-sauna-cold-plunges-health-impacts-2025-05-29
title: 'Ice Baths and Saunas: Are the Latest Health Trends Bad for Your Lungs?'
summary: 'Ice Baths and Saunas: Are the Latest Health Trends Bad for Your Lungs? is an external public/protocol source for Cold Plunge; it is used for attribution, public expectation management, and safety boundaries rather than direct efficacy synthesis.'
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
  title: 'Ice Baths and Saunas: Are the Latest Health Trends Bad for Your Lungs?'
  authors: American Lung Association Editorial Staff
  year: 2025
  journal: American Lung Association
  url: https://www.lung.org/blog/sauna-cold-plunges-health-impacts
  citation: 'American Lung Association Editorial Staff. Ice Baths and Saunas: Are the Latest Health Trends Bad for Your Lungs?. American Lung Association. May 29, 2025. https://www.lung.org/blog/sauna-cold-plunges-health-impacts.'
sourceIdentity:
  identityKind: web_page
  canonicalIdBasis: url
  identifiers:
    titleHash: de4b25c5f7f5fdd1d41af54cdb3606f428ba04e78ef3553a94354d5f4fd5b0eb
    url: https://www.lung.org/blog/sauna-cold-plunges-health-impacts
  canonicalUrl: https://www.lung.org/blog/sauna-cold-plunges-health-impacts
  identityAliases:
  - 'Ice Baths and Saunas: Are the Latest Health Trends Bad for Your Lungs?'
  - American Lung Association (May 29, 2025)
  - https://www.lung.org/blog/sauna-cold-plunges-health-impacts
researchEvidence:
  designKind: other
  designLabel: Respiratory public safety explainer
  populationLabel: General public with emphasis on people who are pregnant, children, older adults, and people with chronic heart or lung conditions.
  durationLabel: No follow-up; discusses acute exposure and rapid temperature shifts.
  cohortKey: cohort:lungorg-sauna-cold-plunges-health-impacts-2025-05-29
  aggregateRole: context
  notes:
  - 'Intervention/exposure: Cold plunges, ice baths, sauna exposure, and rapid hot-cold switching.'
  - 'Comparator/control: No comparator or control; public safety article.'
  - 'Endpoints: hyperventilation; dizziness/fainting; drowning; blood pressure; heart stress; hypothermia; frostbite; lung symptoms'
  - 'Effect direction: Safety-only guidance; acknowledges possible athlete recovery use but focuses on risks for lung and cardiopulmonary populations.'
  - 'Safety/adverse-event notes: Cold shock with hyperventilation, dizziness, fainting and drowning risk; blood-pressure rise and heart stress; hypothermia and frostbite; risks from hot-cold switching.'
  - 'Limitations: Public health article, not a clinical trial.; Contrast-therapy framing is adjacent to Cold Plunge alone.; No effect estimates or participant data.'
  - 'Population/directness caveat: High-risk respiratory/cardiopulmonary public context; not screened healthy cold-plunge users.'
  - 'Directness to Cold Plunge: adjacent_contrast_safety_context'
  - 'Cold Plunge extraction context: bucket=External protocol/public-claims context; directness=adjacent_variant; claimUse=safety-only; priority=low'
sourceFindings:
- findingId: finding:lungorg-sauna-cold-plunges-health-impacts-2025-05-29:cardiopulmonary-risk-groups
  sourceKey: source_artifact:lungorg-sauna-cold-plunges-health-impacts-2025-05-29
  extractedFromArtifactId: art_lungorg_sauna_cold_plunges_health_impacts_2025_05_29
  findingKind: safety
  population: Pregnant people, children, older adults, and people with chronic heart or lung conditions
  exposure: Sauna and cold plunge / rapid hot-cold exposure
  outcome: High-risk populations
  summary: The source warns that rapid temperature shifts and sauna-cold plunge practices may be risky for pregnant people, children, older adults, and people with chronic heart or lung conditions.
  evidenceUse:
  - safety
- findingId: finding:lungorg-sauna-cold-plunges-health-impacts-2025-05-29:cold-plunge-lung-safety
  sourceKey: source_artifact:lungorg-sauna-cold-plunges-health-impacts-2025-05-29
  extractedFromArtifactId: art_lungorg_sauna_cold_plunges_health_impacts_2025_05_29
  findingKind: safety
  population: General public, especially chronic lung disease populations
  exposure: Cold plunges and ice baths
  outcome: Hyperventilation, fainting, drowning, cardiovascular strain
  summary: The source describes cold shock with hyperventilation, dizziness or fainting, drowning risk, blood-pressure rise, heart stress, hypothermia, and frostbite.
  evidenceUse:
  - safety
- findingId: finding:lungorg-sauna-cold-plunges-health-impacts-2025-05-29:contrast-therapy-boundary
  sourceKey: source_artifact:lungorg-sauna-cold-plunges-health-impacts-2025-05-29
  extractedFromArtifactId: art_lungorg_sauna_cold_plunges_health_impacts_2025_05_29
  findingKind: context
  population: People combining sauna and cold plunges
  exposure: Hot-cold contrast exposure
  outcome: Protocol boundary
  summary: The source is most direct for contrast-therapy safety rather than cold plunge alone, so its claims should be kept as adjacent safety context.
  evidenceUse:
  - context
  - adjacent_variant
coldPlungeExtraction:
  batchId: batch-004
  evidenceBucket: External protocol/public-claims context
  directness: adjacent_variant
  claimUse: safety-only
  priority: low
  artifactRightsStatusGuess: permission_required
  identityResolutionStatus: new_source
aliases:
- 'Ice Baths and Saunas: Are the Latest Health Trends Bad for Your Lungs?'
- American Lung Association (May 29, 2025)
- https://www.lung.org/blog/sauna-cold-plunges-health-impacts
---

This source is included for **External protocol/public-claims context**.

**Findings:** The source warns that rapid temperature shifts and sauna-cold plunge practices may be risky for pregnant people, children, older adults, and people with chronic heart or lung conditions. The source describes cold shock with hyperventilation, dizziness or fainting, drowning risk, blood-pressure rise, heart stress, hypothermia, and frostbite. The source is most direct for contrast-therapy safety rather than cold plunge alone, so its claims should be kept as adjacent safety context.

**Why it matters:** Adds respiratory and cardiopulmonary safety boundaries, especially for hot-cold contrast and chronic lung disease.

**Potential experiment signals:** hyperventilation; dizziness/fainting; drowning risk; blood pressure; heart stress; hypothermia/frostbite.

**Protocol takeaway:** Use to flag cardiopulmonary caution and contrast-therapy boundaries; do not treat as efficacy evidence.

**Claim use:** `safety-only`.

**Population mismatch:** High-risk respiratory/cardiopulmonary public context; not screened healthy cold-plunge users.

**Limitations:** Public health article, not a clinical trial. Contrast-therapy framing is adjacent to Cold Plunge alone. No effect estimates or participant data.

**Artifact and rights note:** This extraction stores metadata and a source page draft only. No copyrighted PDF or page copy is included in Git; preserve the canonical URL and verify rights before storing any downloadable copy.
