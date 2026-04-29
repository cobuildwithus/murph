---
{ "schemaVersion": "murph.commons.page.v1", "entityType": "source_artifact", "key": "source_artifact:doi-10.21273-horttech05673-25", "slug": "sources/evening-light-reduction/doi-10.21273-horttech05673-25", "title": "Evaluation of Blue Light Blocking Glasses under Sunlight and LEDs", "summary": "Spectral-transmission study showing that many marketed blue-light-blocking glasses filter wavelengths below 425 nm and may provide little circadian-relevant protection under LEDs.", "status": "draft", "quality": "usable", "aliases": [ "DOI:10.21273/HORTTECH05673-25", "Jachym Baker Bugbee 2025 blue light blocking glasses sunlight LEDs", "HortTechnology blue light blocking glasses" ], "categories": [ "evening-light-reduction" ], "relations": [ { "type": "related_protocol", "target": "protocol_variant:evening-light-reduction/red-light-glasses-before-bed" }, { "type": "parent_family", "target": "experiment_family:evening-light-reduction" } ], "source": { "kind": "journal_article", "title": "Evaluation of Blue Light Blocking Glasses under Sunlight and LEDs", "authors": "Jachym SM, Baker CD, Bugbee B", "year": 2025, "journal": "HortTechnology", "citation": "Jachym SM, Baker CD, Bugbee B. Evaluation of Blue Light Blocking Glasses under Sunlight and LEDs. HortTechnology. 2025;35(4):612-616. doi:10.21273/HORTTECH05673-25.", "doi": "10.21273/HORTTECH05673-25", "url": "https://journals.ashs.org/view/journals/horttech/35/4/article-p612.xml" }, "sourceIdentity": { "identityKind": "scholarly_work", "canonicalIdBasis": "doi", "identifiers": { "doi": "10.21273/HORTTECH05673-25", "url": "https://journals.ashs.org/view/journals/horttech/35/4/article-p612.xml" }, "canonicalUrl": "https://journals.ashs.org/view/journals/horttech/35/4/article-p612.xml" }, "researchEvidence": { "designKind": "acute_mechanistic", "designLabel": "Laboratory spectral-transmission study (normalized from laboratory_spectral_measurement)", "participantCount": 0, "populationLabel": "Eight commercial glasses or lens types measured under sunlight and LED sources", "durationLabel": "Bench measurement; no follow-up", "aggregateRole": "primary", "cohortKey": "jachym-2025-glasses-sunlight-leds" }, "evidenceBucket": "Lens dose and implementation guardrail", "directness": "measurement_context", "whyItMatters": "Separates true blue/cyan attenuation from marketing claims and highlights LED-specific implementation risk.", "potentialMurphEndpoints": [ "spectral transmission", "blue-photon filtering", "LED-source filtering adequacy", "color perception tradeoff" ], "endpoints": [ "spectral transmission", "blue-photon filtering", "LED-source filtering adequacy", "color perception tradeoff" ], "protocolTakeaway": "Do not assume marketed blue-light blockers reduce circadian-relevant LED light; require spectral data or conservative lens-selection language.", "murphTakeaway": "For a bedtime eyewear protocol, LED and screen spectra matter; lenses that only block sub-425 nm light may miss much of the relevant exposure.", "studyDesign": "Bench spectral-transmission study", "modality": "commercial blue-light-blocking glasses under sunlight and LEDs", "claimUse": "context-only", "claimUseBoundary": "Measurement context for product selection; no human sleep or melatonin endpoints.", "populationMismatch": "No human participants; lens bench testing only.", "limitations": [ "No human biological or sleep outcomes.", "Only tested the included commercial products and light sources.", "Color-perception impact is reported as an implementation tradeoff, not a clinical adverse-event rate." ], "safetyNotes": "A strongly filtering lens reported to block blue photons up to 500 nm also substantially altered color perception.", "sourceFindings": [ { "findingId": "finding:doi-10.21273-horttech05673-25-led-filtering-limits", "sourceKey": "source_artifact:doi-10.21273-horttech05673-25", "extractedFromArtifactId": "art_doi_10_21273_horttech05673_25_fulltext", "findingKind": "measurement_validation", "population": "Eight commercial glasses or lens types under sunlight and LED sources", "exposure": "Blue-light-blocking spectacle lenses measured for spectral transmission", "outcome": "Filtering adequacy and color-perception tradeoff", "summary": "Seven lenses primarily filtered wavelengths below 425 nm, suggesting minimal protection under LED fixtures; a more strongly filtering lens attenuated blue photons up to 500 nm but substantially altered color perception.", "evidenceUse": [ "measurement", "context", "safety" ] } ], "murphV1Priority": "Medium", "pdfRightsStatus": "open_access"
}
---

This source is included for **Lens dose and implementation guardrail**.

**Findings:** Seven lenses primarily filtered wavelengths below 425 nm, suggesting minimal protection under LED fixtures; a more strongly filtering lens attenuated blue photons up to 500 nm but substantially altered color perception.

**Why it matters:** Separates true blue/cyan attenuation from marketing claims and highlights LED-specific implementation risk.

**Potential experiment signals:** spectral transmission, blue-photon filtering, LED-source filtering adequacy, color perception tradeoff

**Protocol takeaway:** Do not assume marketed blue-light blockers reduce circadian-relevant LED light; require spectral data or conservative lens-selection language.

**Claim use:** `context-only`.

## Extraction notes

- **Study design:** Bench spectral-transmission study.
- **Population or measurement target:** Eight commercial glasses or lens types measured under sunlight and LED sources.
- **Duration/follow-up:** Bench measurement; no follow-up.
- **Directness to Red Light Glasses Before Bed:** `measurement_context`.
- **Population mismatch:** No human participants; lens bench testing only.
- **Safety/adverse-event notes:** A strongly filtering lens reported to block blue photons up to 500 nm also substantially altered color perception.

## Limitations

- No human biological or sleep outcomes.
- Only tested the included commercial products and light sources.
- Color-perception impact is reported as an implementation tradeoff, not a clinical adverse-event rate.
