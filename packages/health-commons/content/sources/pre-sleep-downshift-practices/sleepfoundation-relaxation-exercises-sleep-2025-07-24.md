---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:sleepfoundation-relaxation-exercises-sleep-2025-07-24
slug: sources/pre-sleep-downshift-practices/sleepfoundation-relaxation-exercises-sleep-2025-07-24
title: Relaxation Exercises to Help Fall Asleep
summary: "Sleep Foundation consumer health page describing adjacent pre-sleep downshift practices such as breathing, visualization, body scan, yoga nidra, progressive muscle relaxation, and non-sleep deep rest."
status: draft
quality: usable
aliases:
  - Relaxation Exercises To Help Fall Asleep
  - Sleep Foundation Relaxation Exercises
categories:
  - pre-sleep-downshift-practices
relations:

  -
    type: related_protocol
    target: protocol_variant:pre-sleep-downshift-practices/pre-sleep-silent-meditation
  -
    type: parent_family
    target: experiment_family:pre-sleep-downshift-practices
source:
  kind: web_page
  title: Relaxation Exercises To Help Fall Asleep
  authors: "Rob Newsom; medically reviewed by Anis Rehman, MD"
  year: 2025
  journal: Sleep Foundation
  citation: "Newsom R. Relaxation Exercises To Help Fall Asleep. Sleep Foundation. Updated July 24, 2025. Medically reviewed by Anis Rehman, MD."
  url: https://www.sleepfoundation.org/sleep-hygiene/relaxation-exercises-to-help-fall-asleep
sourceIdentity:
  identityKind: web_page
  canonicalIdBasis: url
  identifiers:
    titleHash: df1872f545ee412a0d0087099093302b521af26d0e5a1bf2415d469fb2b27017
    url: https://www.sleepfoundation.org/sleep-hygiene/relaxation-exercises-to-help-fall-asleep
  canonicalUrl: https://www.sleepfoundation.org/sleep-hygiene/relaxation-exercises-to-help-fall-asleep
researchEvidence:
  designKind: other
  designLabel: Consumer health education page with secondary-source references
  populationLabel: "General public with sleep-onset difficulty, bedtime stress, or anxiety."
  durationLabel: Not applicable; not an original intervention study.
  aggregateRole: context
  cohortKey: cohort:sleepfoundation-relaxation-exercises-2025
  notes:
    - "No participant count; this is a consumer health page, not an original study."
evidenceBucket: background_context
directness: background
whyItMatters: "This source helps separate silent meditation from adjacent bedtime downshift practices that involve breath timing, body scanning, muscle tensing, visualization, mantras, or guided audio."
potentialMurphEndpoints:
  - outcome:pre-sleep-stress
  - outcome:pre-sleep-somatic-arousal
  - biomarker:sleep-onset-latency
  - outcome:subjective-sleep-quality
protocolTakeaway: "Use to label adjacent variants and avoid conflating body scan, yoga nidra, progressive muscle relaxation, NSDR, or breathing drills with unguided silent meditation."
murphTakeaway: "For Murph, this page supports taxonomy and safety wording for bedtime relaxation variants, but it should not be promoted as efficacy evidence for the target protocol."
studyDesign: Consumer health education page with references to secondary evidence.
modality: "Relaxation exercises for sleep, including breathing, visualization, body scan, yoga nidra, progressive muscle relaxation, and NSDR."
claimUse: context-only
sourceFindings:

  -
    findingId: finding:sleepfoundation-relaxation-exercises-adjacent-techniques
    sourceKey: source_artifact:sleepfoundation-relaxation-exercises-sleep-2025-07-24
    extractedFromArtifactId: art-batch011-sleepfoundation-relaxation-exercises-sleep-2025-07-24
    findingKind: context
    population: "General readers with sleep-onset difficulty, bedtime stress, or anxiety."
    exposure: "Relaxation exercises before sleep, including slow breathing, diaphragmatic breathing, visualization, body scan, yoga nidra, progressive muscle relaxation, and non-sleep deep rest."
    outcome: Relaxation response and sleep-onset support.
    summary: "The Sleep Foundation page describes stress and anxiety as common contributors to sleep difficulty and presents several relaxation-response practices for bedtime, including breathing exercises, visualization or body scan, yoga nidra, progressive muscle relaxation, and non-sleep deep rest."
    evidenceUse:
      - context
      - adjacent_variant
  -
    findingId: finding:sleepfoundation-relaxation-exercises-meditation-boundary
    sourceKey: source_artifact:sleepfoundation-relaxation-exercises-sleep-2025-07-24
    extractedFromArtifactId: art-batch011-sleepfoundation-relaxation-exercises-sleep-2025-07-24
    findingKind: context
    population: General readers comparing relaxation practices for sleep.
    exposure: "Body scan, yoga nidra, and non-sleep deep rest."
    outcome: Protocol taxonomy boundary for pre-sleep downshift variants.
    summary: "The page classifies body scan as a type of meditation and describes yoga nidra and NSDR as practices that can involve body awareness, breath focus, imagery, mantra, or recorded guidance; NSDR is described as controlled relaxation that is not meant to induce sleep but may help create a highly relaxed pre-sleep state. These formats are adjacent variants and should not be treated as the same exposure as unguided silent meditation before bed."
    evidenceUse:
      - context
      - adjacent_variant
  -
    findingId: finding:sleepfoundation-relaxation-exercises-practice-and-safety-boundary
    sourceKey: source_artifact:sleepfoundation-relaxation-exercises-sleep-2025-07-24
    extractedFromArtifactId: art-batch011-sleepfoundation-relaxation-exercises-sleep-2025-07-24
    findingKind: safety
    population: "People trying relaxation exercises for sleep, especially those with epilepsy, psychiatric conditions, or trauma history."
    exposure: Relaxation exercises before sleep.
    outcome: Practice and safety boundary.
    summary: "The page advises that relaxation exercises tend to work better with repeated practice and alongside sleep hygiene, suggests leaving bed for a relaxing activity if unable to fall back asleep after about 15 minutes of in-bed relaxation, and says most people can use these exercises but those with epilepsy, psychiatric conditions, or a trauma history may benefit from consulting a doctor first."
    evidenceUse:
      - safety
      - context
murphV1Priority: Medium
pdfRightsStatus: permission_required
---
This source is included for **background_context**.

**Findings:**

- `finding:sleepfoundation-relaxation-exercises-adjacent-techniques` — The Sleep Foundation page describes stress and anxiety as common contributors to sleep difficulty and presents several relaxation-response practices for bedtime, including breathing exercises, visualization or body scan, yoga nidra, progressive muscle relaxation, and non-sleep deep rest.
- `finding:sleepfoundation-relaxation-exercises-meditation-boundary` — The page classifies body scan as a type of meditation and describes yoga nidra and NSDR as practices that can involve body awareness, breath focus, imagery, mantra, or recorded guidance; NSDR is described as controlled relaxation that is not meant to induce sleep but may help create a highly relaxed pre-sleep state. These formats are adjacent variants and should not be treated as the same exposure as unguided silent meditation before bed.
- `finding:sleepfoundation-relaxation-exercises-practice-and-safety-boundary` — The page advises that relaxation exercises tend to work better with repeated practice and alongside sleep hygiene, suggests leaving bed for a relaxing activity if unable to fall back asleep after about 15 minutes of in-bed relaxation, and says most people can use these exercises but those with epilepsy, psychiatric conditions, or a trauma history may benefit from consulting a doctor first.

**Why it matters:** This source helps separate silent meditation from adjacent bedtime downshift practices that involve breath timing, body scanning, muscle tensing, visualization, mantras, or guided audio.

**Potential experiment signals:**

- outcome:pre-sleep-stress
- outcome:pre-sleep-somatic-arousal
- biomarker:sleep-onset-latency
- outcome:subjective-sleep-quality

**Protocol takeaway:** Use to label adjacent variants and avoid conflating body scan, yoga nidra, progressive muscle relaxation, NSDR, or breathing drills with unguided silent meditation.

**Claim use:** `context-only`.
