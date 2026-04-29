---
{ "schemaVersion": "murph.commons.page.v1", "entityType": "source_artifact", "key": "source_artifact:evening-light-reduction-doi-10.25039-s026.2018", "slug": "sources/evening-light-reduction/doi-10.25039-s026-2018", "title": "CIE System for Metrology of Optical Radiation for ipRGC-Influenced Responses to Light", "summary": "Metrology standard for quantifying ipRGC-influenced light exposure with photoreceptor-specific/α-opic measures.", "status": "draft", "quality": "usable", "aliases": [ "CIE S 026:2018", "ipRGC light metrology", "melanopic equivalent daylight illuminance" ], "categories": [ "evening-light-reduction" ], "relations": [ { "type": "duplicate_source_identity", "target": "source_artifact:doi-10.25039-s026.2018" }, { "type": "related_protocol", "target": "protocol_variant:evening-light-reduction/red-light-glasses-before-bed" }, { "type": "parent_family", "target": "experiment_family:evening-light-reduction" } ], "source": { "kind": "guideline", "title": "CIE System for Metrology of Optical Radiation for ipRGC-Influenced Responses to Light", "authors": "International Commission on Illumination", "year": 2018, "journal": "CIE Standard", "citation": "International Commission on Illumination. CIE System for Metrology of Optical Radiation for ipRGC-Influenced Responses to Light. CIE S 026:2018. Vienna: CIE; 2018. doi:10.25039/S026.2018.", "doi": "10.25039/S026.2018", "url": "https://cie.co.at/publications/cie-system-metrology-optical-radiation-iprgc-influenced-responses-light" }, "sourceIdentity": { "identityKind": "scholarly_work", "canonicalIdBasis": "doi", "identifiers": { "doi": "10.25039/S026.2018", "url": "https://cie.co.at/publications/cie-system-metrology-optical-radiation-iprgc-influenced-responses-light" }, "canonicalUrl": "https://cie.co.at/publications/cie-system-metrology-optical-radiation-iprgc-influenced-responses-light" }, "researchEvidence": { "designKind": "guideline", "designLabel": "Lighting metrology standard (normalized from metrology_standard)", "participantCount": 0, "populationLabel": "Optical radiation measurements for ipRGC-influenced responses to light", "durationLabel": "Not applicable; measurement standard", "aggregateRole": "primary", "cohortKey": "cie-s026-2018-iprgc-metrology" }, "evidenceBucket": "Lens dose and implementation guardrail", "directness": "measurement_context", "whyItMatters": "Provides the measurement vocabulary needed to describe melanopic/circadian light dose instead of relying on photopic lux or lens color.", "potentialMurphEndpoints": [ "α-opic irradiance", "melanopic equivalent daylight illuminance", "spectral power distribution" ], "endpoints": [ "α-opic irradiance", "melanopic equivalent daylight illuminance", "spectral power distribution" ], "protocolTakeaway": "Use melanopic/α-opic language for dose guardrails when available; do not equate photopic lux or lens tint with circadian filtering.", "murphTakeaway": "The protocol should store light/lens claims in melanopic or α-opic terms when source data allows.", "studyDesign": "Metrology standard", "modality": "ipRGC-influenced light measurement", "claimUse": "supports-protocol", "claimUseBoundary": "Measurement standard only; no efficacy or safety outcome evidence.", "populationMismatch": "No participant population; measurement standard.", "limitations": [ "Standard does not test eyewear efficacy or user outcomes.", "Access to full standard may require permission or purchase." ], "safetyNotes": "None extracted beyond measurement boundary.", "sourceFindings": [ { "findingId": "finding:doi-10.25039-s026-2018-alpha-opic-metrology", "sourceKey": "source_artifact:evening-light-reduction-doi-10.25039-s026.2018", "extractedFromArtifactId": "art_doi_10_25039_s026_2018_metadata", "findingKind": "measurement_validation", "population": "Lighting and optical-radiation measurements for ipRGC-influenced responses", "exposure": "Spectral light exposure characterized with CIE α-opic and melanopic quantities", "outcome": "Standardized measurement of non-visual light input", "summary": "CIE S 026:2018 formalizes photoreceptor-specific measures for ipRGC-influenced light responses, supporting melanopic/α-opic dose language instead of relying on photopic lux alone.", "evidenceUse": [ "measurement", "context" ] } ], "murphV1Priority": "High", "pdfRightsStatus": "permission_required"
}
---

This source is included for **Lens dose and implementation guardrail**.

**Findings:** CIE S 026:2018 formalizes photoreceptor-specific measures for ipRGC-influenced light responses, supporting melanopic/α-opic dose language instead of relying on photopic lux alone.

**Why it matters:** Provides the measurement vocabulary needed to describe melanopic/circadian light dose instead of relying on photopic lux or lens color.

**Potential experiment signals:** α-opic irradiance, melanopic equivalent daylight illuminance, spectral power distribution

**Protocol takeaway:** Use melanopic/α-opic language for dose guardrails when available; do not equate photopic lux or lens tint with circadian filtering.

**Claim use:** `supports-protocol`.

## Extraction notes

- **Study design:** Metrology standard.
- **Population or measurement target:** Optical radiation measurements for ipRGC-influenced responses to light.
- **Duration/follow-up:** Not applicable; measurement standard.
- **Directness to Red Light Glasses Before Bed:** `measurement_context`.
- **Population mismatch:** No participant population; measurement standard.
- **Safety/adverse-event notes:** None extracted beyond measurement boundary.

## Limitations

- Standard does not test eyewear efficacy or user outcomes.
- Access to full standard may require permission or purchase.
