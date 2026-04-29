---
{ "schemaVersion": "murph.commons.page.v1", "entityType": "source_artifact", "key": "source_artifact:clinicaltrials-nct02698800-2026-04-27", "slug": "sources/evening-light-reduction/clinicaltrials-nct02698800-2026-04-27", "title": "Blue Blockers at Night and Insomnia Symptoms", "summary": "ClinicalTrials.gov registry record for a completed adult insomnia crossover trial of blue-blocking versus clear lenses before bedtime; useful for design context, not as a standalone efficacy result.", "status": "draft", "quality": "usable", "aliases": [ "NCT02698800", "ClinicalTrials.gov NCT02698800", "Blue Blockers at Night and Insomnia Symptoms" ], "categories": [ "evening-light-reduction" ], "relations": [ { "type": "related_protocol", "target": "protocol_variant:evening-light-reduction/red-light-glasses-before-bed" }, { "type": "parent_family", "target": "experiment_family:evening-light-reduction" } ], "source": { "kind": "other", "title": "Blue Blockers at Night and Insomnia Symptoms", "authors": "ClinicalTrials.gov / Columbia University", "year": 2016, "journal": "ClinicalTrials.gov", "citation": "ClinicalTrials.gov. Blue Blockers at Night and Insomnia Symptoms. Identifier: NCT02698800.", "url": "https://clinicaltrials.gov/study/NCT02698800" }, "sourceIdentity": { "identityKind": "trial_registry", "canonicalIdBasis": "registry_id", "identifiers": { "registryId": "NCT02698800", "url": "https://clinicaltrials.gov/study/NCT02698800" }, "canonicalUrl": "https://clinicaltrials.gov/study/NCT02698800" }, "researchEvidence": { "designKind": "other", "designLabel": "Completed single-blind randomized crossover registry record (normalized from registry_record_rct)", "participantCount": 15, "participantCountKind": "reported", "populationLabel": "Adults aged 18 to 65 with insomnia symptoms", "durationLabel": "One-week assigned-lens periods before bedtime in a crossover design", "aggregateRole": "primary", "cohortKey": "nct02698800-blue-blockers-insomnia" }, "evidenceBucket": "Lens dose and implementation guardrail", "directness": "direct_protocol", "whyItMatters": "Captures a directly relevant adult bedtime-eyewear trial design and implementation details for blue-blocking lenses versus clear lenses.", "potentialMurphEndpoints": [ "insomnia symptoms", "sleep quality", "actigraphy", "melatonin suppression" ], "endpoints": [ "insomnia symptoms", "sleep quality", "actigraphy", "melatonin suppression" ], "protocolTakeaway": "Use this registry record for direct adult bedtime-eyewear trial context and artifact tracking; do not use it as an effect estimate without a results source.", "murphTakeaway": "A credible protocol page should distinguish the registry design from any linked publication or posted results.", "studyDesign": "Clinical trial registry record for a randomized crossover trial", "modality": "blue-blocking eyewear before bedtime", "claimUse": "context-only", "claimUseBoundary": "Registry/design context only; not a standalone efficacy or safety result.", "populationMismatch": "Adult insomnia sample; not a general-population home experiment sample.", "limitations": [ "Registry record does not provide a reusable source-owned effect estimate in this extraction.", "Small pilot-sized sample.", "Registry records can differ from later publications or posted results and should not be merged blindly." ], "safetyNotes": "No adverse-event result was extracted from the registry page in this batch; the registered eligibility criteria exclude several sleep, medical, and pregnancy-related contexts.", "sourceFindings": [ { "findingId": "finding:clinicaltrials-nct02698800-registry-design", "sourceKey": "source_artifact:clinicaltrials-nct02698800-2026-04-27", "extractedFromArtifactId": "art_clinicaltrials_nct02698800_2026_04_27_registry_20260427", "findingKind": "context", "population": "15 adults aged 18 to 65 with insomnia symptoms", "exposure": "Blue-blocking lenses worn before bedtime in a crossover registry design", "outcome": "Registered sleep and melatonin endpoints", "summary": "The registry describes a completed single-blind randomized crossover adult insomnia trial comparing blue-blocking lenses with clear lenses before bedtime, with sleep and melatonin-related endpoints; no registry-owned efficacy result is extracted here.", "evidenceUse": [ "context", "measurement" ] } ], "murphV1Priority": "Low", "pdfRightsStatus": "open_access"
}
---

This source is included for **Lens dose and implementation guardrail**.

**Findings:** The registry describes a completed single-blind randomized crossover adult insomnia trial comparing blue-blocking lenses with clear lenses before bedtime, with sleep and melatonin-related endpoints; no registry-owned efficacy result is extracted here.

**Why it matters:** Captures a directly relevant adult bedtime-eyewear trial design and implementation details for blue-blocking lenses versus clear lenses.

**Potential experiment signals:** insomnia symptoms, sleep quality, actigraphy, melatonin suppression

**Protocol takeaway:** Use this registry record for direct adult bedtime-eyewear trial context and artifact tracking; do not use it as an effect estimate without a results source.

**Claim use:** `context-only`.

## Extraction notes

- **Study design:** Clinical trial registry record for a randomized crossover trial.
- **Population or measurement target:** Adults aged 18 to 65 with insomnia symptoms.
- **Duration/follow-up:** One-week assigned-lens periods before bedtime in a crossover design.
- **Directness to Red Light Glasses Before Bed:** `direct_protocol`.
- **Population mismatch:** Adult insomnia sample; not a general-population home experiment sample.
- **Safety/adverse-event notes:** No adverse-event result was extracted from the registry page in this batch; the registered eligibility criteria exclude several sleep, medical, and pregnancy-related contexts.

## Limitations

- Registry record does not provide a reusable source-owned effect estimate in this extraction.
- Small pilot-sized sample.
- Registry records can differ from later publications or posted results and should not be merged blindly.
