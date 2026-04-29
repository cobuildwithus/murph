---
schemaVersion: murph.commons.page.v1
entityType: experiment_family
key: experiment_family:cold-water-immersion
slug: families/cold-water-immersion
title: Cold Water Immersion
summary: Cold-water exposure protocols that put part or all of the body in cold water, kept separated by setting, dose, body coverage, timing, and safety context.
status: field-testing
quality: usable
aliases:
- cold exposure
- cold shower
- winter swimming
categories:
- cold-water-immersion
- recovery
- mood
- autonomic
- safety-first
familyKind: modality
canonicalModality: cold_water_immersion
relations:
- type: related_protocol
  target: protocol_variant:cold-water-immersion/cold-plunge
- type: cites
  target: source_artifact:pmid-39879231
- type: cites
  target: source_artifact:pmid-2010387
- type: cites
  target: source_artifact:pmid-22336838
- type: cites
  target: source_artifact:royallifesaving-cold-water-immersion-therapy-2024-02-26
researchCoverage:
  canonicalLedgerSourceCount: 262
  extractedSourcePageCount: 235
  evidenceAppraisalCount: 235
  scopeNote: Family spans direct cold plunges plus adjacent cold showers, winter/open-water swimming, post-exercise CWI, cryotherapy context, cold-shock physiology, safety guidance, and external public protocol claims. Protocol pages must keep those variants separate.
  auditCutoff: '2026-04-27'
---

Cold Water Immersion is the family for protocols where cold water is the intervention medium. It includes tub or tank cold plunges, ice baths, cold showers, winter or open-water swimming, post-exercise CWI recovery, and contrast-therapy variants, but those are not interchangeable protocols.

The first Murph canonical child is **Cold Plunge**, a controlled, usually head-out tub/plunge/tank experiment. It is intentionally separated from:

1. **Cold showers**, where water contact, dose, and control differ.
2. **Winter or open-water swimming**, where drowning, weather, current, and rescue context dominate.
3. **Post-exercise recovery CWI**, where soreness, training adaptation, and timing after exercise are the main questions.
4. **Cold-air cryotherapy**, where the exposure medium is not water.
5. **Breathwork or breath-hold cold practices**, where submersion and loss-of-consciousness risk create a different safety problem.
6. **Hot-cold contrast stacks**, where heat exposure and sequencing change interpretation.

The ordinary Cold Plunge child is not a clearance pathway for minors, pregnancy/postpartum, older/frail users, cardiovascular disease, arrhythmia/channelopathy, cold urticaria/anaphylaxis, cold injury/circulation disorders, clinical mental-health treatment, open-water swimming, breathwork/submersion practices, post-exercise recovery, or sauna-to-plunge contrast stacks. Those require separate variants, clinician/professional supervision, or exclusion from ordinary wellness experimentation. Source basis: `source_artifact:royallifesaving-cold-water-immersion-therapy-2024-02-26`, `source_artifact:pmid-36396152`, `source_artifact:pmid-26617380`, `source_artifact:pmid-34862605`, `source_artifact:doi-10.1002-lim2.70009`, `source_artifact:pmid-41602813`, `source_artifact:pmid-38379489`, `source_artifact:wimhofmethod-faq-safety-2026-04-27`.

Family-level interpretation should stay conservative. Cold-water immersion has plausible acute mood, stress, autonomic, tissue-cooling, and habituation signals, but the same family also contains strong cold-shock, cardiovascular, hypothermia, drowning, and population-screening boundaries. Source basis: `source_artifact:pmid-39879231`, `source_artifact:pmid-2010387`, `source_artifact:pmid-22336838`, `source_artifact:royallifesaving-cold-water-immersion-therapy-2024-02-26`.
