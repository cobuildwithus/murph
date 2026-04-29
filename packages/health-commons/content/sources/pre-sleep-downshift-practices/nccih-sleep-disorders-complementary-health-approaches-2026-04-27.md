---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:nccih-sleep-disorders-complementary-health-approaches-2026-04-27
slug: sources/pre-sleep-downshift-practices/nccih-sleep-disorders-complementary-health-approaches-2026-04-27
title: Sleep Disorders and Complementary Health Approaches
summary: NCCIH consumer page on complementary approaches for sleep disorders; useful for external-claim cleanup and safety framing.
status: draft
quality: usable
aliases:
  - "Sleep Disorders and Complementary Health Approaches: Usefulness and Safety"
categories:
  - pre-sleep-downshift-practices
relations:

  -
    type: related_protocol
    target: protocol_variant:pre-sleep-downshift-practices/pre-sleep-silent-meditation
  -
    type: parent_family
    target: experiment_family:pre-sleep-downshift-practices
source:
  kind: web_page
  title: Sleep Disorders and Complementary Health Approaches
  authors: National Center for Complementary and Integrative Health
  year: 2024
  journal: NCCIH Health Information
  citation: "National Center for Complementary and Integrative Health. Sleep Disorders and Complementary Health Approaches. Last updated May 2024. Site last updated April 27, 2026."
  url: https://www.nccih.nih.gov/health/sleep-disorders-and-complementary-health-approaches
sourceIdentity:
  identityKind: web_page
  canonicalIdBasis: url
  identifiers:
    titleHash: 8f1a12a0534dac18a0c42700f62cca9e9e4ad4a0a2b14eb83d627a8492b6cbcb
    url: https://www.nccih.nih.gov/health/sleep-disorders-and-complementary-health-approaches
  canonicalUrl: https://www.nccih.nih.gov/health/sleep-disorders-and-complementary-health-approaches
researchEvidence:
  designKind: narrative_review
  designLabel: Government consumer evidence and safety summary
  populationLabel: General public and people with sleep disorders.
  durationLabel: Not applicable.
  aggregateRole: primary
  cohortKey: cohort:nccih-consumer-sleep-disorders-complementary-approaches
  notes:
    - "Original extracted designKind: consumer_evidence_summary."
evidenceBucket: digital_app_guided_variants
whyItMatters: "Offers patient-facing boundaries for usefulness and safety, including not treating mindfulness as established insomnia therapy by itself."
protocolTakeaway: "Use for context and safety only; it supports cautious wording and clinician-discussion prompts, not direct efficacy claims."
murphTakeaway: Good external-claim guardrail for public health language and adverse-effect uncertainty.
studyDesign: Government consumer evidence summary
modality: external health information page
claimUse: context-only
sourceFindings:

  -
    findingId: finding:nccih-sleep-disorders-complementary-health-approaches-2026-04-27-consumer-boundary-and-safety
    sourceKey: source_artifact:nccih-sleep-disorders-complementary-health-approaches-2026-04-27
    extractedFromArtifactId: art_batch006_nccih_sleep_disorders_complementary_health_approaches_2026_04_27
    findingKind: safety
    population: General public and people considering complementary approaches for sleep problems.
    exposure: Mindfulness practices and other complementary approaches for sleep disorders.
    outcome: "Usefulness and safety boundaries for complementary approaches, including mindfulness."
    summary: "The NCCIH consumer page states that evidence for many complementary approaches is inconsistent or too limited; for mindfulness, it repeats insufficient-evidence guideline boundaries and notes that mindfulness is usually considered low risk but few studies have examined potentially harmful effects."
    evidenceUse:
      - context
      - safety
murphV1Priority: High
pdfRightsStatus: open_access
---
This source is included for **digital_app_guided_variants**.

**Findings:**
- `finding:nccih-sleep-disorders-complementary-health-approaches-2026-04-27-consumer-boundary-and-safety` — The NCCIH consumer page states that evidence for many complementary approaches is inconsistent or too limited; for mindfulness, it repeats insufficient-evidence guideline boundaries and notes that mindfulness is usually considered low risk but few studies have examined potentially harmful effects.

**Why it matters:** Offers patient-facing boundaries for usefulness and safety, including not treating mindfulness as established insomnia therapy by itself.

**Potential experiment signals:** None extracted as source-specific protocol endpoints; use as context/safety boundary.

**Protocol takeaway:** Use for context and safety only; it supports cautious wording and clinician-discussion prompts, not direct efficacy claims.

**Claim use:** `context-only`.
