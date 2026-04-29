---
{ "schemaVersion": "murph.commons.page.v1", "entityType": "source_artifact", "key": "source_artifact:clinicaltrials-nct05206747-2026-04-27", "slug": "sources/evening-light-reduction/clinicaltrials-nct05206747-2026-04-27", "title": "Ottawa Sunglasses at Night for Mania Study", "summary": "ClinicalTrials.gov registry record for a supervised inpatient mania RCT of blue-blocking versus lightly tinted eyewear; psychiatric special-population context only.", "status": "draft", "quality": "usable", "aliases": [ "NCT05206747", "Ottawa Sunglasses at Night for Mania", "Sunglasses at Night mania study" ], "categories": [ "evening-light-reduction" ], "relations": [ { "type": "related_protocol", "target": "protocol_variant:evening-light-reduction/red-light-glasses-before-bed" }, { "type": "parent_family", "target": "experiment_family:evening-light-reduction" } ], "source": { "kind": "other", "title": "Ottawa Sunglasses at Night for Mania Study", "authors": "ClinicalTrials.gov / Ottawa Hospital Research Institute", "year": 2022, "journal": "ClinicalTrials.gov", "citation": "ClinicalTrials.gov. Ottawa Sunglasses at Night for Mania Study. Identifier: NCT05206747.", "url": "https://clinicaltrials.gov/study/NCT05206747" }, "sourceIdentity": { "identityKind": "trial_registry", "canonicalIdBasis": "registry_id", "identifiers": { "registryId": "NCT05206747", "url": "https://clinicaltrials.gov/study/NCT05206747" }, "canonicalUrl": "https://clinicaltrials.gov/study/NCT05206747" }, "researchEvidence": { "designKind": "other", "designLabel": "Completed randomized parallel-arm supervised mania registry record (normalized from registry_record_rct)", "participantCount": 42, "participantCountKind": "reported", "populationLabel": "Hospitalized adults with mania in bipolar disorder", "durationLabel": "Inpatient adjunctive eyewear schedule, including evening-through-morning wear windows", "aggregateRole": "primary", "cohortKey": "nct05206747-ottawa-sunglasses-mania" }, "evidenceBucket": "Clinical or special-population supervised variant", "directness": "clinical_supervised", "whyItMatters": "Defines a psychiatric supervised-use boundary where blue-blocking eyewear is tested as adjunctive treatment for mania and sleep/circadian rhythms.", "potentialMurphEndpoints": [ "Young Mania Rating Scale", "actigraphy", "sleep", "melatonin", "circadian rhythms" ], "endpoints": [ "Young Mania Rating Scale", "actigraphy", "sleep", "melatonin", "circadian rhythms" ], "protocolTakeaway": "Use as clinical-supervised boundary evidence only; 14-hour/inpatient mania use is not the same as a consumer bedtime glasses habit.", "murphTakeaway": "Psychiatric populations and mania protocols require supervised interpretation and should not be converted into wellness claims.", "studyDesign": "Clinical trial registry record for a randomized parallel-arm inpatient mania trial", "modality": "blue-blocking eyewear as adjunctive psychiatric circadian treatment", "claimUse": "context-only", "claimUseBoundary": "Clinical supervised mania context; not direct evidence for adult self-experiment sleep improvement.", "populationMismatch": "Hospitalized adults with acute mania/bipolar disorder and supervised adjunctive care.", "limitations": [ "Registry record is not extracted as a source-owned efficacy result here.", "Acute psychiatric inpatient population differs sharply from the target protocol population.", "Long evening-through-morning wear window differs from before-bed-only glasses use." ], "safetyNotes": "Psychiatric-specialist supervision is central; no registry-owned adverse-event result is extracted in this batch.", "sourceFindings": [ { "findingId": "finding:clinicaltrials-nct05206747-mania-registry-design", "sourceKey": "source_artifact:clinicaltrials-nct05206747-2026-04-27", "extractedFromArtifactId": "art_clinicaltrials_nct05206747_2026_04_27_registry_20260427", "findingKind": "safety", "population": "Hospitalized adults with mania in bipolar disorder", "exposure": "Blue-blocking glasses used as adjunctive inpatient circadian treatment compared with lightly tinted eyewear", "outcome": "Registered mania, sleep, actigraphy, melatonin, and circadian endpoints", "summary": "The registry describes a supervised inpatient mania RCT of blue-blocking eyewear; it is a clinical boundary source and not adult consumer protocol efficacy evidence.", "evidenceUse": [ "context", "safety" ] } ], "murphV1Priority": "Low", "pdfRightsStatus": "unknown"
}
---

This source is included for **Clinical or special-population supervised variant**.

**Findings:** The registry describes a supervised inpatient mania RCT of blue-blocking eyewear; it is a clinical boundary source and not adult consumer protocol efficacy evidence.

**Why it matters:** Defines a psychiatric supervised-use boundary where blue-blocking eyewear is tested as adjunctive treatment for mania and sleep/circadian rhythms.

**Potential experiment signals:** Young Mania Rating Scale, actigraphy, sleep, melatonin, circadian rhythms

**Protocol takeaway:** Use as clinical-supervised boundary evidence only; 14-hour/inpatient mania use is not the same as a consumer bedtime glasses habit.

**Claim use:** `context-only`.

## Extraction notes

- **Study design:** Clinical trial registry record for a randomized parallel-arm inpatient mania trial.
- **Population or measurement target:** Hospitalized adults with mania in bipolar disorder.
- **Duration/follow-up:** Inpatient adjunctive eyewear schedule, including evening-through-morning wear windows.
- **Directness to Red Light Glasses Before Bed:** `clinical_supervised`.
- **Population mismatch:** Hospitalized adults with acute mania/bipolar disorder and supervised adjunctive care.
- **Safety/adverse-event notes:** Psychiatric-specialist supervision is central; no registry-owned adverse-event result is extracted in this batch.

## Limitations

- Registry record is not extracted as a source-owned efficacy result here.
- Acute psychiatric inpatient population differs sharply from the target protocol population.
- Long evening-through-morning wear window differs from before-bed-only glasses use.
