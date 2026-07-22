---
schemaVersion: "murph.commons.page.v1"
entityType: "experiment_family"
key: "experiment_family:consistent-wake-time"
slug: "families/consistent-wake-time"
title: "Consistent Wake Time"
summary: "Wake-time-anchored sleep-regularity interventions that aim to reduce day-to-day wake drift while protecting adequate sleep opportunity."
status: "draft"
quality: "usable"
aliases:
  - "sleep-wake regularity"
categories:
  - "sleep"
  - "circadian"
  - "sleep-regularity"
  - "behavior-change"
familyKind: "intervention"
relations:

  -
    type: "related_protocol"
    target: "protocol_variant:consistent-wake-time/consistent-wake-time"
  -
    type: "primary_biomarker"
    target: "biomarker:wake-time-variability"
  -
    type: "secondary_biomarker"
    target: "biomarker:total-sleep-time"
  -
    type: "secondary_biomarker"
    target: "biomarker:daytime-sleepiness"
  -
    type: "cites"
    target: "source_artifact:consistent-wake-time-bibliography"
  -
    type: "cites"
    target: "source_artifact:pmid-8843535"
  -
    type: "cites"
    target: "source_artifact:pmid-33864369"
  -
    type: "cites"
    target: "source_artifact:pmid-37684151"
  -
    type: "cites"
    target: "source_artifact:pmid-26039963"
  -
    type: "cites"
    target: "source_artifact:pmid-30239905"
  -
    type: "cites"
    target: "source_artifact:pmid-33164742"
researchCoverage:
  bibliographyKey: "source_artifact:consistent-wake-time-bibliography"
  corpusStats:
    canonicalSourceRecords: 71
    draftSourcePageRecords: 67
    excludedOrLinkOnlyRecords: 4
    directOrNearDirectRecords: 8
    measurementRecords: 10
    safetyBoundaryRecords: 21
    auditCutoff: "2026-04-24"
  note: "The family is intentionally narrow for this materialization run; broader sleep-wake regularity, bedtime regularity, social-jetlag reduction, CBT-I fixed-rise-time care, and shift-work fatigue management should remain separate variants or adjacent context."
---

Consistent Wake Time is the wake-time-anchored member of the broader sleep-regularity space.

Use this family for protocols where the main behavior is choosing and maintaining a stable final wake/rise window while preserving enough sleep. Do not collapse it with full sleep hygiene, bedtime-only regularity, CBT-I, sleep restriction, morning light therapy, melatonin, delayed sleep-wake phase treatment, social-jetlag reduction, or shift-work adaptation.

The default child protocol is **Consistent Wake Time**, a 14-day baseline plus 28-day intervention that tracks wake-time variability, sleep opportunity, daytime sleepiness, and confounders.

## Extraction Notes

Four ledger records were excluded or link-only in this run; they have no source pages, no atomic findings, and should not be cited as evidence for protocol claims.

## Future Extraction Candidate

One excluded source was identified as an unusually direct dissertation-level wake-time-regularity candidate, but it was not extracted for this package. Do not use it for protocol claims unless a later extraction creates atomic findings and a rights-safe source page.
