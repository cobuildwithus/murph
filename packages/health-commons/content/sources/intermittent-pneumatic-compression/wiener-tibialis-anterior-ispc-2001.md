---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:wiener-tibialis-anterior-ispc-2001
slug: sources/intermittent-pneumatic-compression/wiener-tibialis-anterior-ispc-2001
title: "Enhancement of Tibialis Anterior Recovery by Intermittent Sequential Pneumatic Compression of the Legs"
summary: "Dose, hemodynamics, and wearable-relevant mechanisms source for the pneumatic compression pants research package. Role: context-only; directness: same_mechanism. Mechanism or wearable-relevant context; not standalone efficacy evidence. Rights unclear; verify before adding downloadable artifacts."
status: draft
quality: usable
categories:
  - intermittent-pneumatic-compression
relations:

  -
    type: related_protocol
    target: protocol_variant:intermittent-pneumatic-compression/pneumatic-compression-pants
  -
    type: parent_family
    target: experiment_family:intermittent-pneumatic-compression
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: url
  identifiers:
    url: "https://www.bio.unipd.it/~bam/PDF/11-2/01459Wiener.pdf"
  canonicalUrl: "https://www.bio.unipd.it/~bam/PDF/11-2/01459Wiener.pdf"
source:
  kind: journal_article
  title: "Enhancement of Tibialis Anterior Recovery by Intermittent Sequential Pneumatic Compression of the Legs"
  url: "https://www.bio.unipd.it/~bam/PDF/11-2/01459Wiener.pdf"
researchEvidence:
  designKind: acute_mechanistic
  designLabel: "contralateral within subject experimental study"
  populationLabel: "See source extraction; use role/directness metadata rather than assuming consumer-pants generalization."
  aggregateRole: context
evidenceBucket: "Dose, hemodynamics, and wearable-relevant mechanisms"
directness: "same_mechanism"
claimUse: "context-only"
murphV1Priority: "medium"
pdfRightsStatus: "unknown"
---

This source is included for **Dose, hemodynamics, and wearable-relevant mechanisms**.

**Findings:** The actively recovering tibialis anterior had significantly higher EMG mean power frequency than the passively recovering leg, independent of side. The beginning of load B was significantly higher than end of load A in the active leg but not the passive leg.

**Why it matters:** It gives a wearable-relevant leg sleeve dose and neuromuscular recovery signal.

**Potential experiment signals:** Tibialis anterior EMG mean power frequency, contractile capacity after fatigue.

**Protocol takeaway:** EMG/neuromuscular endpoints are plausible but should be treated as exploratory and not generalized.

**Safety and limitations:** No adverse events were extracted from accessible materials unless noted above. Key limitations: Very small sample.; Older source with unclear rights.; EMG surrogate outcome.; Contralateral within-subject design may not generalize to whole-body recovery..

**Claim use:** `context-only`.
