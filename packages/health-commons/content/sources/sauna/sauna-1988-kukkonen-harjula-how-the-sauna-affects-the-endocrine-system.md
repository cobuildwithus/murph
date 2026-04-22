---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:sauna-1988-kukkonen-harjula-how-the-sauna-affects-the-endocrine-system
slug: sources/sauna/sauna-1988-kukkonen-harjula-how-the-sauna-affects-the-endocrine-system
title: "How the sauna affects the endocrine system"
summary: "This narrative physiology review summarizes how sauna bathing affects endocrine regulation. The main finding is that heat exposure can activate hormonal stress and recovery pathways, with context-dependent effects. For Murph, it is a mechanism and safety source rather than a result-card endpoint."
status: draft
quality: usable
categories:
  - sauna
  - review
  - safety-physiology
relations:
  -
    type: related_protocol
    target: protocol_variant:dry-sauna/murph-finnish-standard-3x-week
  -
    type: parent_family
    target: experiment_family:dry-sauna
source:
  kind: review
  title: "How the sauna affects the endocrine system"
  authors: "Kukkonen-Harjula K, Kauppinen K"
  year: 1988
  journal: "Ann Clin Res"
  citation: "Kukkonen-Harjula K, Kauppinen K. How the sauna affects the endocrine system. Ann Clin Res 1988;20:262-266."
  pmid: "3218898"
  url: https://pubmed.ncbi.nlm.nih.gov/3218898/
researchEvidence:
  designKind: "narrative_review"
  designLabel: "Narrative physiology review"
  aggregateRole: "synthesis"
protocolEvidence:
  -
    protocolKey: protocol_variant:dry-sauna/murph-finnish-standard-3x-week
    groupId: safety-dose-modality-and-context-boundaries
    stance: safety_boundary
    scope: same_mechanism
    result: not_efficacy_evidence
    headline: "This narrative physiology review summarizes how sauna bathing affects endocrine regulation. The main finding is that heat exposure can activate hormonal stress and recovery pathways, with context-dependent effects."
    implication: "This source is a mechanism and safety source rather than a result-card endpoint."
    caveat: "Safety and special-population records support screening, stopping rules, and logging; they are not efficacy proof."
    displayPriority: 140
  -
    protocolKey: protocol_variant:dry-sauna/murph-finnish-standard-3x-week
    groupId: evidence-backbone-and-claim-calibration
    stance: mixed
    scope: same_mechanism
    result: mixed
    headline: "This endocrine review reinforces that sauna is a real systemic stressor, which supports mechanism plausibility without turning hormone changes into promised consumer outcomes."
    implication: "Use it as evidence-backbone context for mechanism plausibility and overclaim control."
    caveat: "Narrative endocrine review evidence explains plausibility; it is not a direct protocol efficacy result."
    displayPriority: 150
evidenceBucket: Finnish dry-sauna corpus
whyItMatters: "Expands the audited Finnish dry-sauna evidence corpus with a safety / physiology record marked lower priority for Murph v1 interpretation."
potentialMurphEndpoints:
  - safety screening
  - session tolerance
protocolTakeaway: "Use for safety screening and session-context interpretation rather than efficacy claims."
murphTakeaway: "This source is a mechanism and safety source rather than a result-card endpoint."
studyDesign: "Narrative physiology review"
modality: "Sauna (unspecified / likely dry)"
finnishDrySaunaFocus: "Likely"
murphV1Priority: "Lower"
---

This source is part of Murph's audited Finnish dry-sauna yes/likely corpus.

**Findings:** This narrative physiology review summarizes how sauna bathing affects endocrine regulation. The main finding is that heat exposure can activate hormonal stress and recovery pathways, with context-dependent effects.

**Why it matters:** Expands the audited Finnish dry-sauna evidence corpus with a safety / physiology record marked lower priority for Murph v1 interpretation.

**Potential Murph endpoints/context:** safety screening, session tolerance

**Protocol takeaway:** Use for safety screening and session-context interpretation rather than efficacy claims.

Direct PubMed metadata is now attached so the source card can point to the actual endocrine-system review record rather than a secondary bibliography row.
