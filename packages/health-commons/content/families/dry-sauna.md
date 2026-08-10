---
schemaVersion: "murph.commons.page.v1"
entityType: "experiment_family"
key: "experiment_family:dry-sauna"
slug: "families/dry-sauna"
title: "Dry Sauna"
summary: "Traditional high-temperature dry-sauna exposure, separated from infrared sauna, steam rooms, hot-water immersion, Waon therapy, cold-contrast routines, and external named protocols."
status: "field-testing"
quality: "usable"
aliases:
  - "Finnish sauna"
  - "Finnish dry sauna"
  - "traditional Finnish sauna"
  - "traditional dry sauna"
categories:
  - "passive-heat"
  - "sauna"
  - "recovery"
  - "cardiovascular"
familyKind: "modality"
parentFamilyKey: "experiment_family:sauna"
canonicalModality: "finnish_dry_sauna"
relations:

  -
    type: "related_protocol"
    target: "protocol_variant:dry-sauna/murph-finnish-standard-3x-week"
  -
    type: "cites"
    target: "source_artifact:pmid-29849692"
  -
    type: "cites"
    target: "source_artifact:pmid-30077204"
  -
    type: "cites"
    target: "source_artifact:pmid-38577299"
  -
    type: "cites"
    target: "source_artifact:pmid-16871826"
  -
    type: "cites"
    target: "source_artifact:pmid-3218894"
  -
    type: "cites"
    target: "source_artifact:pmid-38344040"
  -
    type: "cites"
    target: "source_artifact:saunasociety-sauna-experience-2026-04-27"
researchCoverage:
  currentResearchRun: "finnish-dry-sauna-research-restart-20260427"
  ledgerSourceCount: 265
  usableAppraisalCount: 108
  usableSourceFindingCount: 158
  usableSourcePageCount: 104
  auditDate: "2026-04-27"
  notes:
    - "Generated source index was absent from the snapshot; duplicate checks used the canonical ledger and visible content files."
    - "Extraction batches with cold-water mismatch, contaminated fasting content, or missing JSON were not used for protocol-specific claims."
---

Dry sauna is the family for high-temperature, low-humidity sauna exposure. The first Murph-owned version here is a **Finnish Dry Sauna** experiment.

Dry sauna stays separate from infrared sauna, steam rooms, Waon therapy, hot-water immersion, cold plunges, and contrast routines because dose, humidity, heat source, user experience, and evidence base can differ enough to change both safety and interpretation.

Traditional Finnish sauna also has humidity nuance: water can be thrown on stones and the perceived heat can change quickly. The family should therefore define the runnable protocol instead of assuming every “sauna” label means the same exposure.

The current research run supports a conservative framing. Dry-sauna reviews and acute physiology make a short self-test plausible, but adjacent passive-heat studies, external high-heat routines, public-sauna guidance, pregnancy and medication guidance, fertility caution sources, and mixed/null findings keep the family from promising long-term disease prevention or universal wearable improvements.
