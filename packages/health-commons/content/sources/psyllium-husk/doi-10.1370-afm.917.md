---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:doi-10.1370-afm.917"
slug: "sources/psyllium-husk/doi-10.1370-afm.917"
title: "The effects of barley-derived soluble fiber on serum lipids"
summary: "Meta-analysis of 8 RCTs (391 adults) found barley-derived beta-glucan lowered total cholesterol and LDL-C, with triglyceride effects less robust after sensitivity analyses."
status: "draft"
quality: "usable"
aliases:
  - "The effects of barley-derived soluble fiber on serum lipids"
  - "source_artifact:doi-10.1370-afm.917"
categories:
  - "psyllium-husk"
relations:

  -
    type: "related_protocol"
    target: "protocol_variant:psyllium-husk/psyllium-husk-for-cholesterol"
  -
    type: "parent_family"
    target: "experiment_family:psyllium-husk"
source:
  kind: "review"
  title: "The effects of barley-derived soluble fiber on serum lipids"
  authors: "Talati R, Baker WL, Pabilonia MS, White CM, Coleman CI"
  year: 2009
  journal: "Annals of Family Medicine"
  citation: "Talati R, Baker WL, Pabilonia MS, White CM, Coleman CI. The effects of barley-derived soluble fiber on serum lipids. Ann Fam Med. 2009;7(2):157-163. doi:10.1370/afm.917."
  doi: "10.1370/afm.917"
  url: "https://doi.org/10.1370/afm.917"
sourceIdentity:
  identityKind: "scholarly_work"
  canonicalIdBasis: "doi"
  identifiers:
    doi: "10.1370/afm.917"
    url: "https://doi.org/10.1370/afm.917"
  canonicalUrl: "https://doi.org/10.1370/afm.917"
researchEvidence:
  designKind: "meta_analysis"
  designLabel: "Meta-analysis of randomized controlled trials"
  participantCount: 391
  participantCountKind: "reported"
  populationLabel: "Healthy and hypercholesterolemic adults in barley-derived soluble-fiber trials"
  durationLabel: "4 to 12 weeks"
  aggregateRole: "primary"
  cohortKey: "doi-10.1370-afm.917-primary"
evidenceBucket: "Adjacent variants, soluble-fiber comparators, and population mismatch"
whyItMatters: "Provides a well-described barley beta-glucan comparator showing that viscous cereal fibers can lower LDL-C, while also documenting methodological caveats and matrix differences."
potentialMurphEndpoints:
  - "total cholesterol"
  - "LDL-C"
  - "HDL-C"
  - "triglycerides"
protocolTakeaway: "Use only as adjacent soluble-fiber context; do not generalize barley beta-glucan effect sizes to psyllium husk."
murphTakeaway: "Barley beta-glucan is a useful comparator for viscosity-mediated LDL-C lowering, but its food matrix, dose, and study quality are distinct from psyllium husk monotherapy."
studyDesign: "meta_analysis"
modality: "barley-derived beta-glucan / soluble fiber"
directness: "adjacent_variant"
claimUse: "context-only"
sourceFindings:

  -
    findingId: "finding:doi-10.1370-afm.917-barley-beta-glucan-lipid-lowering"
    sourceKey: "source_artifact:doi-10.1370-afm.917"
    extractedFromArtifactId: "art_doi_10_1370_afm_917_full_text"
    findingKind: "intervention_result"
    population: "Healthy and hypercholesterolemic adults in barley-derived soluble-fiber trials"
    exposure: "Barley foods or barley-derived beta-glucan, reported doses 3 to 10 g/day"
    outcome: "Serum total cholesterol, LDL-C, HDL-C, and triglycerides"
    summary: "Barley significantly reduced total cholesterol (WMD -13.38 mg/dL, 95% CI -18.46 to -8.31), LDL-C (WMD -10.02 mg/dL, 95% CI -14.03 to -6.00), and triglycerides (WMD -11.83 mg/dL, 95% CI -20.12 to -3.55), with no significant HDL-C reduction; triglyceride reduction was not robust after excluding crossover or non-double-blind studies."
    evidenceUse:
      - "context"
      - "adjacent_variant"
  -
    findingId: "finding:doi-10.1370-afm.917-barley-beta-glucan-method-caveat"
    sourceKey: "source_artifact:doi-10.1370-afm.917"
    extractedFromArtifactId: "art_doi_10_1370_afm_917_full_text"
    findingKind: "context"
    population: "Healthy and hypercholesterolemic adults in barley-derived soluble-fiber trials"
    exposure: "Barley-derived beta-glucan RCT evidence base"
    outcome: "Evidence certainty and transferability"
    summary: "Only two included studies were double-blinded; control conditions were incompletely described; study-selection and validity-assessment methods were unclear; language bias could not be ruled out. This is barley-derived beta-glucan evidence, not psyllium monotherapy."
    evidenceUse:
      - "adjacent_variant"
      - "context"
murphV1Priority: "Medium"
pdfRightsStatus: "open_access"
---
This source is included for **Adjacent variants, soluble-fiber comparators, and population mismatch**.

**Findings:** Barley significantly reduced total cholesterol (WMD -13.38 mg/dL, 95% CI -18.46 to -8.31), LDL-C (WMD -10.02 mg/dL, 95% CI -14.03 to -6.00), and triglycerides (WMD -11.83 mg/dL, 95% CI -20.12 to -3.55), with no significant HDL-C reduction; triglyceride reduction was not robust after excluding crossover or non-double-blind studies.

**Safety / adverse events:** No source-level adverse-event signal was extracted from the accessible review summary.

**Why it matters:** Provides a well-described barley beta-glucan comparator showing that viscous cereal fibers can lower LDL-C, while also documenting methodological caveats and matrix differences.

**Potential experiment signals:** total cholesterol, LDL-C, HDL-C, triglycerides.

**Limitations / population mismatch:** Only two included studies were double-blinded; control conditions were incompletely described; study-selection and validity-assessment methods were unclear; language bias could not be ruled out. This is barley-derived beta-glucan evidence, not psyllium monotherapy.

**Protocol takeaway:** Use only as adjacent soluble-fiber context; do not generalize barley beta-glucan effect sizes to psyllium husk.

**Claim use:** `context-only`.
