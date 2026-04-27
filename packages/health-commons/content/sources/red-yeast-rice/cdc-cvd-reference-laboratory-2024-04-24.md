---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:cdc-cvd-reference-laboratory-2024-04-24"
slug: "sources/red-yeast-rice/cdc-cvd-reference-laboratory-2024-04-24"
title: "CDC Cardiovascular Disease Reference Laboratory"
summary: "CDC laboratory-quality source for lipid-measurement standardization. It supports lab-fidelity and repeat-testing design for an LDL-C protocol endpoint, not any red-yeast-rice efficacy claim."
status: "draft"
quality: "usable"
aliases:
  - "CDC CVD Reference Laboratory"
  - "CDC lipid reference laboratory"
  - "CDC CRMLN lipid standardization"
categories:
  - "red-yeast-rice"
  - "lipid-measurement"
relations:
  -
    type: "related_protocol"
    target: "protocol_variant:red-yeast-rice/red-yeast-rice-for-cholesterol"
  -
    type: "parent_family"
    target: "experiment_family:red-yeast-rice"
source:
  kind: "web_page"
  title: "CDC Cardiovascular Disease Reference Laboratory"
  authors: "Centers for Disease Control and Prevention"
  year: 2024
  journal: "CDC Clinical Standardization Programs"
  citation: "Centers for Disease Control and Prevention. CVD Reference Laboratory. Clinical Standardization Programs. Updated April 24, 2024. Accessed April 26, 2026."
  url: "https://www.cdc.gov/clinical-standardization-programs/php/cvd/cvd-reference-laboratory.html"
sourceIdentity:
  identityKind: "web_page"
  canonicalIdBasis: "url"
  identifiers:
    titleHash: "43da24a4b8414c23b9e2533351a0dc1dce914d15552118e2809345861a9deba0"
    url: "https://www.cdc.gov/clinical-standardization-programs/php/cvd/cvd-reference-laboratory.html"
  canonicalUrl: "https://www.cdc.gov/clinical-standardization-programs/php/cvd/cvd-reference-laboratory.html"
researchEvidence:
  designKind: "other"
  designLabel: "CDC lipid reference laboratory and standardization-program context"
  populationLabel: "Clinical laboratories, manufacturers, and lipid standardization programs using reference procedures or certification systems."
  durationLabel: "Program/web page; updated April 24, 2024."
  aggregateRole: "primary"
  cohortKey: "cdc-cvd-reference-laboratory-2024-04-24"
evidenceBucket: "Lipid measurement and test-plan context"
whyItMatters: "Lipid changes from a red-yeast-rice protocol can be over- or under-interpreted if pre/post panels use inconsistent or poorly standardized lab methods."
potentialMurphEndpoints:
  - "lab-fidelity"
  - "LDL-C"
  - "HDL-C"
  - "total cholesterol"
  - "triglycerides"
protocolTakeaway: "Use the same reliable, standardized lipid-testing workflow when possible; this source is not evidence that red yeast rice lowers cholesterol."
murphTakeaway: "Use standardized lipid labs and keep LDL-C method consistency visible in the test plan."
studyDesign: "Laboratory standardization context"
modality: "Lipid measurement and cholesterol test-plan context"
claimUse: "context-only"
sourceFindings:
  -
    findingId: "finding:cdc-cvd-reference-laboratory-2024-04-24-lipid-panel-standardization"
    sourceKey: "source_artifact:cdc-cvd-reference-laboratory-2024-04-24"
    findingKind: "measurement_validation"
    population: "Clinical laboratories, manufacturers, and lipid standardization programs using reference procedures or certification systems."
    exposure: "CDC reference procedures and lipid-measurement standardization services for total cholesterol, total glycerides, HDL-C, and LDL-C."
    outcome: "lab-fidelity, LDL-C, HDL-C, total cholesterol, triglycerides"
    summary: "CDC describes reference measurement procedures and standardization services for total cholesterol, total glycerides, HDL-C, and LDL-C. For this protocol, the reusable finding is that lipid-panel outcomes should be interpreted with lab-method and standardization fidelity in mind."
    evidenceUse:
      - "measurement"
      - "context"
murphV1Priority: "Medium"
pdfRightsStatus: "unknown"
---
This source is included for **Lipid measurement and test-plan context**.

## Quick read

- **Source type:** CDC lipid reference laboratory and standardization-program context (2024).
- **People or setting studied:** Clinical laboratories, manufacturers, and lipid standardization programs using reference procedures or certification systems.
- **Exposure or intervention:** CDC reference procedures and lipid-measurement standardization services for total cholesterol, total glycerides, HDL-C, and LDL-C.
- **Comparator or control:** Non-standardized or non-reference-aligned lipid testing workflows.
- **Duration or follow-up:** Program/web page; updated April 24, 2024.
- **Role in Murph:** context-only / measurement_context.

## Findings

CDC describes reference measurement procedures and standardization services for total cholesterol, total glycerides, HDL-C, and LDL-C. For this protocol, the reusable finding is that lipid-panel outcomes should be interpreted with lab-method and standardization fidelity in mind.

**Effect estimate or direction extracted:** CDC describes reference measurements and laboratory-standardization services rather than clinical effect estimates.

## Why it matters

Lipid changes from a red-yeast-rice protocol can be over- or under-interpreted if pre/post panels use inconsistent or poorly standardized lab methods.

## Potential experiment signals

lab-fidelity, LDL-C, HDL-C, total cholesterol, triglycerides

## Protocol takeaway

Use the same reliable, standardized lipid-testing workflow when possible; this source is not evidence that red yeast rice lowers cholesterol.

## Claim use

`context-only`. This source should not be promoted into a direct protocol efficacy claim unless the protocol text explicitly labels it as measurement context or adjacent-variant context.

## Safety and adverse events

No participant safety outcomes; source is a laboratory-methods webpage.

## Limitations and population mismatch

Web page is programmatic and does not report participant-level intervention data or red-yeast-rice outcomes. The canonical ledger URL returned as a legacy CDC path during extraction, so the current CDC page is used as the canonical URL.

**Population or modality mismatch:** Not a red-yeast-rice study; laboratory measurement context only.

## Extraction note

The batch ledger listed `https://www.cdc.gov/labquality/cvd.html`. During this extraction that legacy CDC path was not used as the canonical URL; the current official CDC Clinical Standardization Programs page is recorded in source metadata.
