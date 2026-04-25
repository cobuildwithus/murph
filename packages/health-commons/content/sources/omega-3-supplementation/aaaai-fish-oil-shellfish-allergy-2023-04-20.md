---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:aaaai-fish-oil-shellfish-allergy-2023-04-20
slug: sources/omega-3-supplementation/aaaai-fish-oil-shellfish-allergy-2023-04-20
title: Fish oil safety in a shellfish allergic patient
summary: AAAAI expert guidance says fish-oil risk is very unlikely in a shellfish-allergic patient who tolerates finned fish, but purified-product variability prevents a no-risk guarantee.
status: draft
quality: usable
aliases:
- Demain JG 2023
- Fish oil safety in a shellfish allergic patient
categories:
- omega-3-supplementation
relations:
-
  type: related_protocol
  target: protocol_variant:omega-3-supplementation/oral-epa-dha-supplementation
-
  type: parent_family
  target: experiment_family:omega-3-supplementation
source:
  kind: web_page
  title: Fish oil safety in a shellfish allergic patient
  authors: Demain JG / American Academy of Allergy, Asthma & Immunology Ask the Expert
  year: 2023
  journal: American Academy of Allergy, Asthma & Immunology
  citation: Demain JG / American Academy of Allergy, Asthma & Immunology Ask the Expert. Fish oil safety in a shellfish allergic patient. American Academy of Allergy, Asthma & Immunology. 2023.
  url: https://www.aaaai.org/allergist-resources/ask-the-expert/answers/2023/fishoil
researchEvidence:
  designKind: guideline
  designLabel: Specialist allergy Q&A / expert guidance
  populationLabel: Patients with shellfish allergy considering fish-oil supplementation, especially when finned fish is tolerated
  durationLabel: Not applicable
  aggregateRole: context
  cohortKey: aaaai-2023-shellfish-allergy-fish-oil
evidenceBucket: safety_adverse_events
whyItMatters: Specialist guidance separates shellfish allergy from finned-fish allergy and clarifies uncertainty around purified supplements.
potentialMurphEndpoints:
- shellfish allergy
- finned fish tolerance
- allergic reaction history
- in-office oral challenge
- product ingredients
protocolTakeaway: 'Use as specialist allergy boundary: shellfish allergy alone does not necessarily imply fish-oil allergy, but product purity cannot be guaranteed.'
murphTakeaway: The protocol should screen for fish/shellfish allergy and suggest allergist input or supervised challenge where risk is uncertain.
studyDesign: Expert guidance
modality: Fish-oil supplement exposure
claimUse: safety-only
murphV1Priority: Medium
pdfRightsStatus: unknown
---
This source is included for **safety_adverse_events**.

**Findings:** AAAAI guidance emphasizes that a shellfish-allergic patient who tolerates finned fish is unlikely to react to fish oil, because allergens are proteins and purified oil should contain little protein. It also notes that absolute absence of protein cannot be guaranteed and that supervised challenge can be considered.

**Why it matters:** Specialist guidance separates shellfish allergy from finned-fish allergy and clarifies uncertainty around purified supplements.

**Potential experiment signals:** shellfish allergy, finned fish tolerance, allergic reaction history, in-office oral challenge, product ingredients.

**Protocol takeaway:** Use as specialist allergy boundary: shellfish allergy alone does not necessarily imply fish-oil allergy, but product purity cannot be guaranteed.

**Claim use:** `safety-only`.

**Directness:** `safety_boundary` for `protocol_variant:omega-3-supplementation/oral-epa-dha-supplementation`.

**Limitations and population mismatch:** Expert opinion informed by sparse case reports and small challenge data; product purification and individual allergy history remain variable.
