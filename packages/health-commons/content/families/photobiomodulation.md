---
schemaVersion: murph.commons.page.v1
entityType: experiment_family
key: experiment_family:photobiomodulation
slug: families/photobiomodulation
title: Photobiomodulation
summary: The broad red and near-infrared light therapy family, with dose, device, evidence-fit, and safety boundaries kept distinct from specific body sites and outcomes.
status: draft
quality: usable
aliases:
  - red light therapy
  - PBM
  - PBMT
  - red and near-infrared light therapy
  - red/NIR light therapy
categories:
  - photobiomodulation
  - red-light
  - near-infrared
  - light
familyKind: modality
relations:
  - type: child_family
    target: experiment_family:skin-photobiomodulation
  - type: child_family
    target: experiment_family:whole-body-photobiomodulation
  - type: cites
    target: source_artifact:pmid-38309304
  - type: cites
    target: source_artifact:pmid-38307144
  - type: cites
    target: source_artifact:pmid-38674067
  - type: cites
    target: source_artifact:fda-k230124-led-facewear-mask-eye-protection-2023-02-09
  - type: cites
    target: source_artifact:canada-risk-thermal-harm-energy-devices-2020-08-21
claims:
  - claimId: family-definition-and-mechanism-boundary
    type: evidence_scope
    text: Photobiomodulation uses non-ablative light, commonly red or near-infrared, to produce parameter-dependent biological effects without using heat as the intended dose. Proposed cellular mechanisms support plausibility but do not prove a clinical benefit.
    strength: moderate
    sourceKeys:
      - source_artifact:pmid-38309304
      - source_artifact:pmid-38674067
  - claimId: family-evidence-is-context-specific
    type: mixed_evidence
    text: PBM evidence varies by wavelength, irradiance, fluence, pulse mode, device geometry, body site, population, schedule, comparator, and outcome. Evidence from one setup should not be treated as proof for another setup or a general wellness claim.
    strength: high
    sourceKeys:
      - source_artifact:pmid-38309304
      - source_artifact:pmid-38307144
      - source_artifact:pmid-38674067
  - claimId: surface-fluence-duration-calculation
    type: design_guardrail
    text: When target fluence and irradiance describe the same wavelength mode, distance or contact geometry, and body site, estimated seconds equal target J/cm² multiplied by 1000 and divided by irradiance mW/cm²; minutes equal seconds divided by 60. This estimates incident surface fluence, not absorbed dose in deeper tissue.
    strength: high
    sourceKeys:
      - source_artifact:fda-k230124-led-facewear-mask-eye-protection-2023-02-09
    caveats:
      - Use the irradiance at the actual treatment distance or contact setting and active mode.
      - Label manufacturer irradiance values as claims and round the result to practical precision.
      - Do not calculate when units, geometry, mode, wavelength scope, target site, or target fluence do not match.
  - claimId: device-and-eye-safety-boundary
    type: safety
    text: Follow the exact device instructions and eye-protection requirements. Stop for burning, marked skin irritation, unusual pain, headache, persistent afterimages, new eye symptoms, or dizziness. Heat is a safety signal, not the PBM dose.
    strength: high
    sourceKeys:
      - source_artifact:fda-k230124-led-facewear-mask-eye-protection-2023-02-09
      - source_artifact:canada-risk-thermal-harm-energy-devices-2020-08-21
    caveats:
      - Get qualified guidance for eye treatment, photosensitizing medicines or topicals, active cancer care, suspicious lesions, pregnancy, reduced sensation, impaired circulation, or an active skin condition.
---

Photobiomodulation is the broad family for red and near-infrared light therapy. It keeps general education and dose interpretation separate from evidence for one body site, device, condition, or outcome.

## Dose interpretation

Use area-normalized dose math only when the inputs match:

```text
seconds = target J/cm² × 1000 ÷ irradiance mW/cm²
minutes = seconds ÷ 60
```

For example, `12 J/cm²` at `109 mW/cm²` is about `110 seconds`, or `1.8 minutes`. Round this to a practical device setting. Treat it as a surface-fluence estimate, not a measured deep-tissue dose.

Do not calculate from total watts, LED count, total joules without exposed area, a reading from another distance, or a combined-mode reading used for a single wavelength. Current official device instructions or a user-provided manual should supply mutable device values. Health Commons does not keep a static consumer-device catalog.

## Family boundary

Skin, whole-body, eye, brain, hair, wound, pain, and exercise-timed PBM can have different evidence and safety needs. Use the matching child family when it exists. Do not collapse PBM into infrared sauna, bright-light therapy, circadian red lighting, ultraviolet tanning, laser ablation, IPL, or photodynamic therapy.
