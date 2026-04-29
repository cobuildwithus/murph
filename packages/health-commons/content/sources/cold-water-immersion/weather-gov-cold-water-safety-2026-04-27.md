---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:weather-gov-cold-water-safety-2026-04-27
slug: sources/cold-water-immersion/weather-gov-cold-water-safety-2026-04-27
title: Cold Water Hazards and Safety
summary: Cold Water Hazards and Safety is an external public/protocol source for Cold Plunge; it is used for attribution, public expectation management, and safety boundaries rather than direct efficacy synthesis.
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
  title: Cold Water Hazards and Safety
  authors: National Weather Service
  journal: National Weather Service
  url: https://www.weather.gov/safety/coldwater
  citation: National Weather Service. Cold Water Hazards and Safety. National Weather Service. Accessed April 27, 2026. https://www.weather.gov/safety/coldwater.
sourceIdentity:
  identityKind: guideline
  canonicalIdBasis: url
  identifiers:
    titleHash: a4e83dfc2285ea39c573705b1ac6a2699e083ca02a66372bf8b66ff192548535
    url: https://www.weather.gov/safety/coldwater
  canonicalUrl: https://www.weather.gov/safety/coldwater
  identityAliases:
  - Cold Water Hazards and Safety
  - National Weather Service (Accessed April 27, 2026)
  - https://www.weather.gov/safety/coldwater
researchEvidence:
  designKind: guideline
  designLabel: Government cold-water safety guidance
  populationLabel: General public exposed to cold water, especially boaters, paddlers, swimmers, and people at risk of accidental immersion.
  durationLabel: Immediate cold shock period through hypothermia risk after immersion.
  cohortKey: cohort:weather-gov-cold-water-safety-2026-04-27
  aggregateRole: context
  notes:
  - 'Intervention/exposure: Cold-water immersion or falling into cold water; not a therapeutic cold plunge protocol.'
  - 'Comparator/control: No comparator or control; government safety guidance.'
  - 'Endpoints: cold shock; gasping; rapid breathing; heart rate; blood pressure; drowning; physical incapacitation; hypothermia'
  - 'Effect direction: Safety-only guidance states that cold shock can occur even at temperatures often considered only cool and can be life-threatening.'
  - 'Safety/adverse-event notes: Cold shock, gasping, rapid breathing, heart-rate and blood-pressure increases, cognitive impairment, physical incapacitation, drowning, and hypothermia.'
  - 'Limitations: Safety guidance for accidental or open-water exposure, not a therapeutic cold-plunge study.; No efficacy endpoints or participant counts.; Open-water hazard context may overstate risk for supervised controlled tubs, but hazards remain relevant.'
  - 'Population/directness caveat: Accidental/open-water context; not a screened, supervised, controlled cold-plunge environment.'
  - 'Directness to Cold Plunge: same_mechanism_safety_context'
  - 'Cold Plunge extraction context: bucket=External protocol/public-claims context; directness=general_guideline; claimUse=safety-only; priority=high'
sourceFindings:
- findingId: finding:weather-gov-cold-water-safety-2026-04-27:cold-shock-temperature-boundary
  sourceKey: source_artifact:weather-gov-cold-water-safety-2026-04-27
  extractedFromArtifactId: art_weather_gov_cold_water_safety_2026_04_27
  findingKind: safety
  population: General public exposed to cold water
  exposure: Cold-water immersion or falling into cold water
  outcome: Cold shock at non-freezing temperatures
  summary: The source states that cold shock can be severe at 50-60°F and that gasping or uncontrolled breathing can occur in water far warmer than freezing, so temperature perception alone is not a safe boundary.
  evidenceUse:
  - safety
- findingId: finding:weather-gov-cold-water-safety-2026-04-27:first-minutes-incapacitation
  sourceKey: source_artifact:weather-gov-cold-water-safety-2026-04-27
  extractedFromArtifactId: art_weather_gov_cold_water_safety_2026_04_27
  findingKind: safety
  population: General public exposed to cold water
  exposure: Cold-water immersion
  outcome: First-minutes drowning and incapacitation risk
  summary: The source describes the first minutes of immersion as a critical cold-shock window with rapid breathing, heart-rate and blood-pressure increases, possible cognitive impairment, physical incapacitation, and drowning risk.
  evidenceUse:
  - safety
- findingId: finding:weather-gov-cold-water-safety-2026-04-27:hypothermia-preparedness
  sourceKey: source_artifact:weather-gov-cold-water-safety-2026-04-27
  extractedFromArtifactId: art_weather_gov_cold_water_safety_2026_04_27
  findingKind: safety
  population: General public exposed to cold water
  exposure: Cold-water immersion and post-exit period
  outcome: Hypothermia and preparedness
  summary: The source frames hypothermia and post-immersion hazards as safety concerns and recommends preparedness such as checking water temperature and using flotation/safety measures.
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
- Cold Water Hazards and Safety
- National Weather Service (Accessed April 27, 2026)
- https://www.weather.gov/safety/coldwater
---

This source is included for **External protocol/public-claims context**.

**Findings:** The source states that cold shock can be severe at 50-60°F and that gasping or uncontrolled breathing can occur in water far warmer than freezing, so temperature perception alone is not a safe boundary. The source describes the first minutes of immersion as a critical cold-shock window with rapid breathing, heart-rate and blood-pressure increases, possible cognitive impairment, physical incapacitation, and drowning risk. The source frames hypothermia and post-immersion hazards as safety concerns and recommends preparedness such as checking water temperature and using flotation/safety measures.

**Why it matters:** Authoritative safety source for cold shock and the fact that dangerous responses can occur well above freezing temperatures.

**Potential experiment signals:** cold shock symptoms; breathing rate; heart rate; blood pressure; drowning risk; hypothermia symptoms.

**Protocol takeaway:** Use as a safety boundary for cold shock, drowning, incapacitation, and hypothermia; do not use for efficacy.

**Claim use:** `safety-only`.

**Population mismatch:** Accidental/open-water context; not a screened, supervised, controlled cold-plunge environment.

**Limitations:** Safety guidance for accidental or open-water exposure, not a therapeutic cold-plunge study. No efficacy endpoints or participant counts. Open-water hazard context may overstate risk for supervised controlled tubs, but hazards remain relevant.

**Artifact and rights note:** This extraction stores metadata and a source page draft only. No copyrighted PDF or page copy is included in Git; preserve the canonical URL and verify rights before storing any downloadable copy.
