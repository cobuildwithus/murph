---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:wimhofmethod-faq-safety-2026-04-27
slug: sources/cold-water-immersion/wimhofmethod-faq-safety-2026-04-27
title: Frequently Asked Questions
summary: Frequently Asked Questions is an external public/protocol source for Cold Plunge; it is used for attribution, public expectation management, and safety boundaries rather than direct efficacy synthesis.
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
- type: same_work_as
  target: source_artifact:wimhofmethod-breathing-water-fainting-2026-04-26
source:
  kind: external_protocol
  title: Frequently Asked Questions
  authors: Wim Hof Method
  journal: Wim Hof Method
  url: https://www.wimhofmethod.com/faq
  citation: Wim Hof Method. Frequently Asked Questions. Wim Hof Method. Accessed April 27, 2026. https://www.wimhofmethod.com/faq.
sourceIdentity:
  identityKind: web_page
  canonicalIdBasis: url
  identifiers:
    titleHash: 6de98c8dfed3c841994fe02375b39b82d820fb6bfecadd04cb8fafae534ded41
    url: https://www.wimhofmethod.com/faq
  canonicalUrl: https://www.wimhofmethod.com/faq
  identityAliases:
  - Frequently Asked Questions
  - Wim Hof Method (Accessed April 27, 2026)
  - https://www.wimhofmethod.com/faq
researchEvidence:
  designKind: expert_protocol
  designLabel: Branded method FAQ and safety page
  populationLabel: People considering Wim Hof Method breathing and cold exposure; includes contraindication advice.
  durationLabel: No follow-up; practical safety and eligibility guidance.
  cohortKey: cohort:wimhofmethod-faq-safety-2026-04-27
  aggregateRole: context
  notes:
  - 'Intervention/exposure: Wim Hof Method breathing, cold exposure, and hot/cold contrast claims; cold exposure involving water.'
  - 'Comparator/control: No comparator or control; branded FAQ.'
  - 'Endpoints: contraindications; breathing-induced lightheadedness; loss of consciousness; drowning risk; hot-cold contrast claims'
  - 'Effect direction: Safety and public-claim context only; no cold-plunge efficacy estimate.'
  - 'Safety/adverse-event notes: Warnings include lightheadedness/loss of consciousness from breathing exercises, drowning risk if breathing techniques are done in water, and contraindications for multiple conditions.'
  - 'Limitations: Branded FAQ, not independent evidence.; Wim Hof Method bundles breathing, mindset, and cold exposure.; No participant count, comparator, or effect estimate.'
  - 'Population/directness caveat: Branded method users; not isolated cold plunge or Murph user cohort.'
  - 'Directness to Cold Plunge: adjacent_bundled_method_safety_context'
  - 'Cold Plunge extraction context: bucket=External protocol/public-claims context; directness=general_guideline; claimUse=safety-only; priority=high'
sourceFindings:
- findingId: finding:wimhofmethod-faq-safety-2026-04-27:contraindication-list
  sourceKey: source_artifact:wimhofmethod-faq-safety-2026-04-27
  extractedFromArtifactId: art_wimhofmethod_faq_safety_2026_04_27
  findingKind: safety
  population: People considering Wim Hof Method practices
  exposure: Breathing exercises and cold exposure
  outcome: Contraindications
  summary: The FAQ advises against the method for several conditions, including coronary heart disease, cold urticaria, epilepsy, kidney failure, Raynaud's type II, uncontrolled/high blood pressure on medication, history of heart failure or stroke, and other cautions.
  evidenceUse:
  - safety
- findingId: finding:wimhofmethod-faq-safety-2026-04-27:breathing-water-drowning-warning
  sourceKey: source_artifact:wimhofmethod-faq-safety-2026-04-27
  extractedFromArtifactId: art_wimhofmethod_faq_safety_2026_04_27
  findingKind: safety
  population: People practicing cold exposure involving water
  exposure: Breathing exercises during water exposure
  outcome: Loss of consciousness and drowning risk
  summary: The FAQ warns that breathing exercises can cause lightheadedness or loss of consciousness and that using the breathing technique in water can create drowning risk.
  evidenceUse:
  - safety
- findingId: finding:wimhofmethod-faq-safety-2026-04-27:hot-cold-research-lacking
  sourceKey: source_artifact:wimhofmethod-faq-safety-2026-04-27
  extractedFromArtifactId: art_wimhofmethod_faq_safety_2026_04_27
  findingKind: context
  population: Wim Hof Method audience
  exposure: Hot/cold contrast practices
  outcome: Evidence boundary
  summary: The FAQ notes that research on hot/cold alternation is lacking or inconclusive, so such claims should remain public-claims context.
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
- Frequently Asked Questions
- Wim Hof Method (Accessed April 27, 2026)
- https://www.wimhofmethod.com/faq
---

This source is included for **External protocol/public-claims context**.

**Findings:** The FAQ advises against the method for several conditions, including coronary heart disease, cold urticaria, epilepsy, kidney failure, Raynaud's type II, uncontrolled/high blood pressure on medication, history of heart failure or stroke, and other cautions. The FAQ warns that breathing exercises can cause lightheadedness or loss of consciousness and that using the breathing technique in water can create drowning risk. The FAQ notes that research on hot/cold alternation is lacking or inconclusive, so such claims should remain public-claims context.

**Why it matters:** Important safety source because branded cold-exposure audiences may combine breathwork with water; the FAQ itself warns against that unsafe combination.

**Potential experiment signals:** contraindicated conditions; lightheadedness; syncope; drowning risk; breathing practice context.

**Protocol takeaway:** Use for breathwork-in-water prohibition and contraindication mapping only; do not use for efficacy.

**Claim use:** `safety-only`.

**Population mismatch:** Branded method users; not isolated cold plunge or Murph user cohort.

**Limitations:** Branded FAQ, not independent evidence. Wim Hof Method bundles breathing, mindset, and cold exposure. No participant count, comparator, or effect estimate.

**Artifact and rights note:** This extraction stores metadata and a source page draft only. No copyrighted PDF or page copy is included in Git; preserve the canonical URL and verify rights before storing any downloadable copy.
