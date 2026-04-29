---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1192-bja.2023.60
slug: sources/cold-water-immersion/doi-10.1192-bja.2023.60
title: 'Beyond the cold baths: contemporary applications of cold-water immersion in the treatment of clinical depression and anxiety'
summary: Clinical narrative review/refreshment article framing contemporary CWI applications for depression and anxiety and the immaturity of the evidence base.
status: draft
quality: usable
categories:
- cold-water-immersion
- cold-plunge
relations:
- type: parent_family
  target: experiment_family:cold-water-immersion
- type: related_protocol
  target: protocol_variant:cold-water-immersion/cold-plunge
source:
  kind: journal_article
  title: 'Beyond the cold baths: contemporary applications of cold-water immersion in the treatment of clinical depression and anxiety'
  authors: Carlos Carona; Sandra Marques
  year: 2024
  journal: BJPsych Advances
  doi: 10.1192/bja.2023.60
  url: https://doi.org/10.1192/bja.2023.60
  citation: 'Carona C, Marques S. Beyond the cold baths: contemporary applications of cold-water immersion in the treatment of clinical depression and anxiety. BJPsych Advances. 2024;30(5):271-273. doi:10.1192/bja.2023.60.'
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    doi: 10.1192/bja.2023.60
    titleHash: 32c4b7639dc6ebb3b625cb21c02475c7efe1caae8264cdeeb91b19089807b5dc
    url: https://doi.org/10.1192/bja.2023.60
  canonicalUrl: https://doi.org/10.1192/bja.2023.60
  identityAliases:
  - doi:10.1192/bja.2023.60
  - Carlos Carona 2024
  - 'Beyond the cold baths: contemporary applications of cold-water immersion in the treatment of clinical depression and anxiety'
researchEvidence:
  designKind: narrative_review
  designLabel: Clinical narrative review / refreshment article
  populationLabel: People with depression/anxiety in reviewed clinical-adjacent literature
  durationLabel: Not applicable; narrative review
  cohortKey: cohort:carona-marques-2024-cwi-clinical-review
  aggregateRole: primary
  notes:
  - 'Intervention/exposure: Cold-water immersion modalities discussed as adjunctive/clinical applications'
  - 'Comparator/control: Not applicable'
  - 'Endpoints: depression; anxiety; mood; mechanisms; contraindications; side effects'
  - 'Effect direction: Review-level conclusion: current evidence is too methodologically weak and inconsistent to support clear clinical conclusions.'
  - 'Safety/adverse-event notes: Calls for attention to contraindications and side-effects; not a primary adverse-event dataset.'
  - 'Limitations: Narrative/brief review rather than systematic synthesis.; Evidence base described as small, methodologically limited, and inconsistent.; Clinical use remains early and should not be generalized to unsupervised wellness protocols.'
  - 'Population/directness caveat: Clinical depression/anxiety treatment context differs from general wellness cold plunge.'
  - 'Directness to Cold Plunge: clinical_supervised'
  - 'Cold Plunge extraction context: bucket=Mental health, stress, mood, and wellbeing context; directness=clinical_supervised; claimUse=context-only; priority=medium'
sourceFindings:
- findingId: finding:doi-10.1192-bja.2023.60:clinical-review-evidence-boundary
  sourceKey: source_artifact:doi-10.1192-bja.2023.60
  extractedFromArtifactId: art_doi_10_1192_bja_2023_60
  findingKind: context
  population: Clinical depression/anxiety literature and CWI application context
  exposure: Contemporary cold-water immersion applications including cold baths, cold showers, and cold facial immersion
  outcome: Clinical depression and anxiety treatment rationale, mechanisms, limitations, contraindications
  summary: Brief clinical narrative review describes CWI as an emerging adjunctive area for depression and anxiety but emphasizes that low methodological quality, small non-clinical samples, and inconsistent protocols preclude clear conclusions; clinical efficacy remains in its infancy.
  evidenceUse:
  - context
  - safety
coldPlungeExtraction:
  batchId: batch-006
  evidenceBucket: Mental health, stress, mood, and wellbeing context
  directness: clinical_supervised
  claimUse: context-only
  priority: medium
  artifactRightsStatusGuess: permission_required
  identityResolutionStatus: new_source
aliases:
- doi:10.1192/bja.2023.60
- Carlos Carona 2024
- 'Beyond the cold baths: contemporary applications of cold-water immersion in the treatment of clinical depression and anxiety'
- 10.1192/bja.2023.60
---

This source is included for **Mental health, stress, mood, and wellbeing context**.

**Findings:** Brief clinical narrative review describes CWI as an emerging adjunctive area for depression and anxiety but emphasizes that low methodological quality, small non-clinical samples, and inconsistent protocols preclude clear conclusions; clinical efficacy remains in its infancy.

**Why it matters:** Provides a conservative clinical boundary for mental-health treatment claims and safety/contraindication language.

**Potential experiment signals:** depression symptoms, anxiety symptoms, side effects, contraindications.

**Protocol takeaway:** Use to justify conservative mental-health claim boundaries and avoid clinical treatment promises.

**Claim use:** `context-only`.
