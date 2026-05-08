---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:wimhofmethod-regular-ice-baths-2026-04-27
slug: sources/cold-water-immersion/wimhofmethod-regular-ice-baths-2026-04-27
title: Regular Ice Baths
summary: Regular Ice Baths is an external public/protocol source for Cold Plunge; it is used for attribution, public expectation management, and safety boundaries rather than direct efficacy synthesis.
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
- type: same_work_as
  target: source_artifact:wimhofmethod-cold-showers-2026-04-27
source:
  kind: external_protocol
  title: Regular Ice Baths
  authors: Wim Hof Method
  journal: Wim Hof Method
  url: https://www.wimhofmethod.com/regular-ice-baths
  citation: Wim Hof Method. Regular Ice Baths. Wim Hof Method. Accessed April 27, 2026. https://www.wimhofmethod.com/regular-ice-baths.
sourceIdentity:
  identityKind: web_page
  canonicalIdBasis: url
  identifiers:
    titleHash: d7f14348484645eb7f176549af24301ef1a45304d35a2e07d1256b0f836d4f55
    url: https://www.wimhofmethod.com/regular-ice-baths
  canonicalUrl: https://www.wimhofmethod.com/regular-ice-baths
  identityAliases:
  - Regular Ice Baths
  - Wim Hof Method (Accessed April 27, 2026)
  - https://www.wimhofmethod.com/regular-ice-baths
researchEvidence:
  designKind: expert_protocol
  designLabel: Branded ice-bath claims page
  populationLabel: General public considering Wim Hof Method ice baths and bundled method practices.
  durationLabel: No study follow-up; recommends gradual progression before ice baths.
  cohortKey: cohort:wimhofmethod-regular-ice-baths-2026-04-27
  aggregateRole: context
  notes:
  - 'Intervention/exposure: Regular ice baths and Wim Hof Method practices combining cold exposure, breathing, and commitment/focus.'
  - 'Comparator/control: No comparator or control; branded public claims and testimonials.'
  - 'Endpoints: physical recovery claims; weight-loss/metabolism claims; parasympathetic/stress claims; sleep claims; disease-related testimonials; graduated exposure safety'
  - 'Effect direction: Branded claims and testimonials only; not independent cold-plunge efficacy evidence.'
  - 'Safety/adverse-event notes: Safety is indirect through gradual progression advice; page does not provide a formal adverse-event summary.'
  - 'Limitations: Branded claims/testimonial page.; Wim Hof Method bundles breathing, mindset, and cold exposure.; Community testimonials are not efficacy evidence.; No participant count, comparator, or effect estimates.'
  - 'Population/directness caveat: Branded method users and testimonials; not a controlled cold-plunge protocol cohort.'
  - 'Directness to Cold Plunge: direct_protocol_external_claim_bundled_method'
  - 'Cold Plunge extraction context: bucket=External protocol/public-claims context; directness=general_guideline; claimUse=context-only; priority=low'
sourceFindings:
- findingId: finding:wimhofmethod-regular-ice-baths-2026-04-27:branded-benefit-claims
  sourceKey: source_artifact:wimhofmethod-regular-ice-baths-2026-04-27
  extractedFromArtifactId: art_wimhofmethod_regular_ice_baths_2026_04_27
  findingKind: context
  population: General public Wim Hof Method audience
  exposure: Regular ice baths and bundled Wim Hof Method practices
  outcome: Recovery, weight, parasympathetic, stress, sleep, and health claims
  summary: The source makes branded public claims about physical recovery, weight-related effects, parasympathetic activation, stress, sleep, and broader health, but it does not provide independent cold-plunge effect estimates.
  evidenceUse:
  - context
- findingId: finding:wimhofmethod-regular-ice-baths-2026-04-27:bundled-method-directness-limit
  sourceKey: source_artifact:wimhofmethod-regular-ice-baths-2026-04-27
  extractedFromArtifactId: art_wimhofmethod_regular_ice_baths_2026_04_27
  findingKind: context
  population: General public Wim Hof Method audience
  exposure: Cold exposure plus breathing and commitment/focus
  outcome: Directness to cold plunge
  summary: Because the method bundles cold exposure with breathing and mindset practices, the source cannot isolate cold plunge effects.
  evidenceUse:
  - context
  - adjacent_variant
- findingId: finding:wimhofmethod-regular-ice-baths-2026-04-27:testimonial-boundary
  sourceKey: source_artifact:wimhofmethod-regular-ice-baths-2026-04-27
  extractedFromArtifactId: art_wimhofmethod_regular_ice_baths_2026_04_27
  findingKind: context
  population: Community members/testimonials
  exposure: Wim Hof Method practices
  outcome: Community outcomes
  summary: The source includes testimonials and community outcomes; these should be labeled as community/public-claim context and not used as efficacy evidence.
  evidenceUse:
  - context
coldPlungeExtraction:
  batchId: batch-004
  evidenceBucket: External protocol/public-claims context
  directness: general_guideline
  claimUse: context-only
  priority: low
  artifactRightsStatusGuess: permission_required
  identityResolutionStatus: new_source
aliases:
- Regular Ice Baths
- Wim Hof Method (Accessed April 27, 2026)
- https://www.wimhofmethod.com/regular-ice-baths
---

This source is included for **External protocol/public-claims context**.

**Findings:** The source makes branded public claims about physical recovery, weight-related effects, parasympathetic activation, stress, sleep, and broader health, but it does not provide independent cold-plunge effect estimates. Because the method bundles cold exposure with breathing and mindset practices, the source cannot isolate cold plunge effects. The source includes testimonials and community outcomes; these should be labeled as community/public-claim context and not used as efficacy evidence.

**Why it matters:** Captures common branded public expectations around ice baths while preserving the boundary that testimonials and bundled methods do not support protocol efficacy claims.

**Potential experiment signals:** public claimed benefits; community outcomes; recovery claims; sleep claims; stress claims; graduated exposure.

**Protocol takeaway:** Use as public-claims audit and community-outcome context only; do not cite for efficacy.

**Claim use:** `context-only`.

**Population mismatch:** Branded method users and testimonials; not a controlled cold-plunge protocol cohort.

**Limitations:** Branded claims/testimonial page. Wim Hof Method bundles breathing, mindset, and cold exposure. Community testimonials are not efficacy evidence. No participant count, comparator, or effect estimates.

**Artifact and rights note:** This extraction stores metadata and a source page draft only. No copyrighted PDF or page copy is included in Git; preserve the canonical URL and verify rights before storing any downloadable copy.
