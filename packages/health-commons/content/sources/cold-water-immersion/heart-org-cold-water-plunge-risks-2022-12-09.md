---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:heart-org-cold-water-plunge-risks-2022-12-09
slug: sources/cold-water-immersion/heart-org-cold-water-plunge-risks-2022-12-09
title: 'You''re not a polar bear: The plunge into cold water comes with risks'
summary: 'You''re not a polar bear: The plunge into cold water comes with risks is an external public/protocol source for Cold Plunge; it is used for attribution, public expectation management, and safety boundaries rather than direct efficacy synthesis.'
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
  title: 'You''re not a polar bear: The plunge into cold water comes with risks'
  authors: Laura Williamson; American Heart Association News
  year: 2022
  journal: American Heart Association News
  url: https://www.heart.org/en/news/2022/12/09/youre-not-a-polar-bear-the-plunge-into-cold-water-comes-with-risks
  citation: 'Laura Williamson; American Heart Association News. You''re not a polar bear: The plunge into cold water comes with risks. American Heart Association News. December 9, 2022. https://www.heart.org/en/news/2022/12/09/youre-not-a-polar-bear-the-plunge-into-cold-water-comes-with-risks.'
sourceIdentity:
  identityKind: web_page
  canonicalIdBasis: url
  identifiers:
    titleHash: 33e36f7a3c5d695bc3ba7ff9ad0edac35dd45996c2d47265e48ceb9e2fa86322
    url: https://www.heart.org/en/news/2022/12/09/youre-not-a-polar-bear-the-plunge-into-cold-water-comes-with-risks
  canonicalUrl: https://www.heart.org/en/news/2022/12/09/youre-not-a-polar-bear-the-plunge-into-cold-water-comes-with-risks
  identityAliases:
  - 'You''re not a polar bear: The plunge into cold water comes with risks'
  - American Heart Association News (December 9, 2022)
  - https://www.heart.org/en/news/2022/12/09/youre-not-a-polar-bear-the-plunge-into-cold-water-comes-with-risks
researchEvidence:
  designKind: narrative_review
  designLabel: Cardiovascular safety news explainer
  populationLabel: General public; emphasizes people with cardiac history or medications that may affect adaptation to cold shock.
  durationLabel: Acute immersion and immediate afterdrop/rewarming period.
  cohortKey: cohort:heart-org-cold-water-plunge-risks-2022-12-09
  aggregateRole: context
  notes:
  - 'Intervention/exposure: Sudden cold-water immersion, polar-bear plunges, cold therapy, winter swimming.'
  - 'Comparator/control: No comparator or control; expert safety discussion.'
  - 'Endpoints: cold shock; breathing control; heart rate; blood pressure; drowning; hypothermia; troponin context'
  - 'Effect direction: No efficacy effect estimates; article states that health benefits are not established and warns of acute cold-shock risks.'
  - 'Safety/adverse-event notes: Cold shock can provoke rapid breathing, increased heart rate and blood pressure, involuntary gasping and drowning; loss of circulation to limbs, loss of strength/coordination, hypothermia, and possible heart stress are described.'
  - 'Limitations: News story, not an original study.; Article notes it is older and some information may be outdated.; Safety claims rely on expert commentary and cited context, not a new systematic appraisal.'
  - 'Population/directness caveat: Public safety narrative; not a controlled protocol study in screened healthy adults.'
  - 'Directness to Cold Plunge: direct_protocol_safety_context'
  - 'Cold Plunge extraction context: bucket=External protocol/public-claims context; directness=general_guideline; claimUse=safety-only; priority=high'
sourceFindings:
- findingId: finding:heart-org-cold-water-plunge-risks-2022-12-09:cold-shock-heart-risk
  sourceKey: source_artifact:heart-org-cold-water-plunge-risks-2022-12-09
  extractedFromArtifactId: art_heart_org_cold_water_plunge_risks_2022_12_09
  findingKind: safety
  population: General public; especially people with cardiac history
  exposure: Sudden cold-water immersion
  outcome: Cold shock and cardiovascular stress
  summary: The source states that plunging into cold water can trigger rapid breathing, increased heart rate, and increased blood pressure; involuntary gasping with the head submerged can lead to drowning and the response stresses the heart.
  evidenceUse:
  - safety
- findingId: finding:heart-org-cold-water-plunge-risks-2022-12-09:hypothermia-rewarming-boundary
  sourceKey: source_artifact:heart-org-cold-water-plunge-risks-2022-12-09
  extractedFromArtifactId: art_heart_org_cold_water_plunge_risks_2022_12_09
  findingKind: safety
  population: General public
  exposure: Cold-water immersion and post-exit period
  outcome: Hypothermia and rewarming safety
  summary: The source describes loss of limb circulation, impaired strength and coordination, and hypothermia risk, and it emphasizes immediate warming and not swimming alone.
  evidenceUse:
  - safety
- findingId: finding:heart-org-cold-water-plunge-risks-2022-12-09:benefit-not-established
  sourceKey: source_artifact:heart-org-cold-water-plunge-risks-2022-12-09
  extractedFromArtifactId: art_heart_org_cold_water_plunge_risks_2022_12_09
  findingKind: context
  population: General public
  exposure: Cold therapy / cold-water immersion
  outcome: Health-benefit claims
  summary: The source reports that evidence supporting cold-therapy health benefits remains scant and that health benefits have not been clearly established.
  evidenceUse:
  - context
coldPlungeExtraction:
  batchId: batch-004
  evidenceBucket: External protocol/public-claims context
  directness: general_guideline
  claimUse: safety-only
  priority: high
  artifactRightsStatusGuess: permission_required
  identityResolutionStatus: new_source
aliases:
- 'You''re not a polar bear: The plunge into cold water comes with risks'
- American Heart Association News (December 9, 2022)
- https://www.heart.org/en/news/2022/12/09/youre-not-a-polar-bear-the-plunge-into-cold-water-comes-with-risks
---

This source is included for **External protocol/public-claims context**.

**Findings:** The source states that plunging into cold water can trigger rapid breathing, increased heart rate, and increased blood pressure; involuntary gasping with the head submerged can lead to drowning and the response stresses the heart. The source describes loss of limb circulation, impaired strength and coordination, and hypothermia risk, and it emphasizes immediate warming and not swimming alone. The source reports that evidence supporting cold-therapy health benefits remains scant and that health benefits have not been clearly established.

**Why it matters:** A credible public cardiovascular source for cold-shock and do-not-plunge-alone boundaries.

**Potential experiment signals:** cold shock symptoms; breathing rate; heart rate; blood pressure; hypothermia symptoms; coordination loss.

**Protocol takeaway:** Use to support safety boundaries only: avoid unsupervised sudden cold-water immersion and caution cardiac-risk users.

**Claim use:** `safety-only`.

**Population mismatch:** Public safety narrative; not a controlled protocol study in screened healthy adults.

**Limitations:** News story, not an original study. Article notes it is older and some information may be outdated. Safety claims rely on expert commentary and cited context, not a new systematic appraisal.

**Artifact and rights note:** This extraction stores metadata and a source page draft only. No copyrighted PDF or page copy is included in Git; preserve the canonical URL and verify rights before storing any downloadable copy.
