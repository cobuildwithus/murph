---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:bmla-drugs-and-lasers-ipls-2018-11-30
slug: sources/whole-body-photobiomodulation/bmla-drugs-and-lasers-ipls-2018-11-30
title: Drugs and Lasers/IPLs
summary: BMLA consensus guidance for aesthetic lasers and IPLs recommends wavelength-aware caution rather than universal exclusion for most photosensitizing drugs, with stricter waits after photodynamic therapy.
status: draft
quality: usable
aliases:
  - bmla-drugs-and-lasers-ipls-2018-11-30
categories:
  - whole-body-photobiomodulation
  - skin-photobiomodulation
relations:
  -
    type: related_protocol
    target: protocol_variant:whole-body-photobiomodulation/whole-body-red-and-near-infrared-light-exposure
  -
    type: parent_family
    target: experiment_family:whole-body-photobiomodulation
  -
    type: related_protocol
    target: protocol_variant:skin-photobiomodulation/red-near-infrared-skin-texture-photoaging
  -
    type: parent_family
    target: experiment_family:skin-photobiomodulation
source:
  kind: guideline
  title: Drugs and Lasers/IPLs
  authors: British Medical Laser Association
  year: 2018
  journal: British Medical Laser Association
  citation: British Medical Laser Association. Drugs and Lasers/IPLs. Written 2018-11-30; based on guidance version 2 issued May 2017. https://bmla.co.uk/drugs-and-laser-ipls/.
  url: https://bmla.co.uk/drugs-and-laser-ipls/
researchEvidence:
  designKind: guideline
  designLabel: Professional guidance for lasers, IPLs, and potentially photosensitizing medications
  populationLabel: Professional guidance for non-essential aesthetic laser or IPL practice in people using potentially photosensitizing drugs
  durationLabel: Standing professional guidance; page written 2018-11-30
  aggregateRole: synthesis
  cohortKey: bmla-2018-drugs-lasers-ipls-guidance
protocolEvidence:
  -
    protocolKey: protocol_variant:whole-body-photobiomodulation/whole-body-red-and-near-infrared-light-exposure
    groupId: safety-and-screening-boundaries
    stance: safety_boundary
    scope: adjacent_variant
    result: not_efficacy_evidence
    headline: Practical guidance recommends especially strict delays after photodynamic therapy drugs, while many other photosensitizing medications warrant caution, test spots, and wavelength review rather than automatic exclusion.
    implication: Useful as a pragmatic comparator for medication-screening language.
    caveat: Consensus guidance for non-essential aesthetic lasers and IPLs, not peer-reviewed whole-body PBM evidence.
    displayPriority: 35
  -
    protocolKey: protocol_variant:skin-photobiomodulation/red-near-infrared-skin-texture-photoaging
    groupId: laser-ipl-medication-guidance
    stance: safety_boundary
    scope: adjacent_variant
    result: not_efficacy_evidence
    headline: BMLA guidance supports medication review while warning against overly rigid drug-light rules.
    implication: Use for medication-screening process language and referral/test-patch caution, not for efficacy claims.
    caveat: Translate laser/IPL cautions conservatively to PBM because device physics differ.
    displayPriority: 63
evidenceBucket: Safety, contraindication, and population-boundary evidence
whyItMatters: This source provides concrete wait-period and test-patch advice that can inform practical screening language even though it is not direct PBM research.
potentialMurphEndpoints:
  - medication review
  - test spot response
  - healing delay
  - skin irritation
protocolTakeaway: Use as practical screening context for medication and healing-risk questions, while keeping the evidence boundary explicit.
murphTakeaway: Helpful for pragmatic caution language, but it should remain clearly labeled as external professional guidance rather than direct protocol evidence.
studyDesign: Professional guidance
modality: Aesthetic laser and IPL treatment guidance
claimUse: safety-only
murphV1Priority: Medium
pdfRightsStatus: open_access
---

This source is included for **Safety, contraindication, and population-boundary evidence**.

**Findings:** The BMLA page states that for the vast majority of drugs there is very little likelihood of a reaction with devices emitting above 500 nm, while noting that some agents can remain sensitive into the visible range. It recommends waiting six months after systemic photodynamic therapy drugs and six weeks after topical PDT drugs. For many other photosensitizing medications it suggests caution, test patches, and small initial treatment areas rather than universal refusal. It also flags drugs that may impair healing, including retinoids and steroids.

**Why it matters:** This source provides concrete wait-period and test-patch advice that can inform practical screening language even though it is not direct PBM research.

**Potential experiment signals:** medication review, test spot response, healing delay, skin irritation.

**Protocol takeaway:** Use as practical screening context for medication and healing-risk questions, while keeping the evidence boundary explicit.

**Claim use:** `safety-only`.

## Skin Photobiomodulation Note

This source is included for **photosensitizing-medication and retinoid safety boundary**.

**Findings:** Guidance notes that many drug-avoidance lists are based on overly rigid interpretation of limited data and provides a structured safety-screening approach for laser/IPL settings.

**Why it matters:** Use for medication-screening process language and referral/test-patch caution, not for efficacy claims.

**Potential experiment signals:** intake medication checklist, nonessential procedure pause, test patch caution.

**Protocol takeaway:** BMLA guidance supports medication review while warning against overly rigid drug-light rules. Translate laser/IPL cautions conservatively to PBM because device physics differ.

**Claim use:** `safety-only`.

### Extraction notes

- **Population:** People considering laser/IPL/light-device procedures and practitioners screening medications.
- **Intervention/exposure:** Medication review before laser/IPL or light-based procedures.
- **Comparator/control:** Not applicable.
- **Duration/follow-up:** Not applicable.
- **Endpoints:** Photosensitivity reactions, medication lists, contraindication cautions, and procedure safety.
- **Adverse events/safety notes:** Photosensitivity reactions and procedure-related burns/blisters are the relevant risks in higher-energy light procedures.
- **Limitations:** Professional guidance page, not PBM clinical trial.; Laser/IPL context may overestimate risk for nonthermal red/NIR LED PBM.; Web-page date/source should be version-controlled.
- **Population mismatch/directness:** Procedure safety boundary; not direct protocol evidence.
- **Artifact/rights status:** unknown.
