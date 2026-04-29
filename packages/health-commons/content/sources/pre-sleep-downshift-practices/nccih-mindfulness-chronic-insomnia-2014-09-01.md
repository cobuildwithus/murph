---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:nccih-mindfulness-chronic-insomnia-2014-09-01
slug: sources/pre-sleep-downshift-practices/nccih-mindfulness-chronic-insomnia-2014-09-01
title: Mindfulness Meditation May Benefit People With Chronic Insomnia
summary: "NCCIH research digest summarizing a small chronic-insomnia mindfulness trial; helpful as plain-language context, but secondary to the underlying RCT and not standalone silent bedtime meditation evidence."
status: draft
quality: usable
aliases:
  - NCCIH mindfulness meditation chronic insomnia 2014
  - Mindfulness Meditation May Benefit People With Chronic Insomnia
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
  title: Mindfulness Meditation May Benefit People With Chronic Insomnia
  authors: National Center for Complementary and Integrative Health
  year: 2014
  journal: NCCIH Research Results
  citation: "National Center for Complementary and Integrative Health. Mindfulness Meditation May Benefit People With Chronic Insomnia. Published September 1, 2014. https://www.nccih.nih.gov/research/research-results/mindfulness-meditation-may-benefit-people-with-chronic-insomnia."
  url: https://www.nccih.nih.gov/research/research-results/mindfulness-meditation-may-benefit-people-with-chronic-insomnia
sourceIdentity:
  identityKind: web_page
  canonicalIdBasis: url
  identifiers:
    titleHash: 7f10d81c41ab6bfedc6d4fc9ce7d2555e04a16e89fa55cf2fbde62b9080cf400
    url: https://www.nccih.nih.gov/research/research-results/mindfulness-meditation-may-benefit-people-with-chronic-insomnia
  canonicalUrl: https://www.nccih.nih.gov/research/research-results/mindfulness-meditation-may-benefit-people-with-chronic-insomnia
researchEvidence:
  designKind: narrative_review
  designLabel: Government research-results summary of a small randomized chronic-insomnia mindfulness trial
  participantCount: 54
  participantCountKind: reported
  populationLabel: Adults with chronic insomnia in the summarized Ong 2014 trial
  durationLabel: Eight-week mindfulness programs plus home practice; outcomes summarized after treatment and follow-up
  aggregateRole: primary
  cohortKey: cohort:pre-sleep-downshift-practices/clinical-insomnia-mindfulness/nccih-2014-ong-digest
  notes:
    - "Original extracted designKind: government_research_digest."
    - "Original extracted participantCountKind: reported_summarized_trial."
evidenceBucket: clinical_insomnia_mindfulness
whyItMatters: "It is a reliable government-facing digest that makes the trial design and limitations easy to understand, but it should not replace extraction from the underlying primary RCT."
potentialMurphEndpoints:
  - total wake time
  - pre-sleep arousal
  - insomnia severity
  - patient-reported sleep quality
  - sleep diary outcomes
protocolTakeaway: Use as secondary clinical-context evidence only; it reinforces that structured mindfulness programs may help chronic insomnia symptoms but does not isolate a silent meditation immediately before bed.
murphTakeaway: Community-facing claims should keep the small-sample and limited-diversity caveats visible.
studyDesign: Government research-results digest of randomized trial
modality: MBSR and mindfulness-based therapy for insomnia
claimUse: context-only
sourceFindings:

  -
    findingId: finding:nccih-mindfulness-chronic-insomnia-2014-09-01/government-digest-ong-2014
    sourceKey: source_artifact:nccih-mindfulness-chronic-insomnia-2014-09-01
    extractedFromArtifactId: art_nccih_mindfulness_chronic_insomnia_2014_09_01_html
    findingKind: context
    population: Adults with chronic insomnia summarized from the Ong 2014 randomized trial.
    exposure: MBSR or mindfulness-based therapy for insomnia compared with self-monitoring.
    outcome: "Total wake time, pre-sleep arousal, patient-reported insomnia symptoms, and intervention burden."
    summary: "The NCCIH research digest reports that 54 adults with chronic insomnia were randomized to MBSR, mindfulness-based therapy for insomnia, or self-monitoring; both meditation treatments reduced total wake time and pre-sleep arousal and outperformed self-monitoring on patient-reported measures, while MBTI showed a larger Insomnia Severity Index reduction than MBSR."
    evidenceUse:
      - context
      - efficacy
      - adjacent_variant
  -
    findingId: finding:nccih-mindfulness-chronic-insomnia-2014-09-01/small-sample-and-diversity-limitations
    sourceKey: source_artifact:nccih-mindfulness-chronic-insomnia-2014-09-01
    extractedFromArtifactId: art_nccih_mindfulness_chronic_insomnia_2014_09_01_html
    findingKind: context
    population: Adults with chronic insomnia summarized in a government research results page.
    exposure: "MBSR and MBTI programs, including substantial home meditation practice."
    outcome: Generalizability and claim-use boundary.
    summary: "The NCCIH page highlights the trial's small sample and limited diversity and notes the need for larger samples and comparisons with standard treatments; the MBSR and MBTI interventions involved weekly sessions and 30-45 minutes of meditation practice at least 6 days per week, which differs from a short silent pre-bed protocol."
    evidenceUse:
      - context
murphV1Priority: Medium
pdfRightsStatus: open_access
---
This source is included for **clinical_insomnia_mindfulness**.

**Findings:** `finding:nccih-mindfulness-chronic-insomnia-2014-09-01/government-digest-ong-2014` — The NCCIH research digest reports that 54 adults with chronic insomnia were randomized to MBSR, mindfulness-based therapy for insomnia, or self-monitoring; both meditation treatments reduced total wake time and pre-sleep arousal and outperformed self-monitoring on patient-reported measures, while MBTI showed a larger Insomnia Severity Index reduction than MBSR.; `finding:nccih-mindfulness-chronic-insomnia-2014-09-01/small-sample-and-diversity-limitations` — The NCCIH page highlights the trial's small sample and limited diversity and notes the need for larger samples and comparisons with standard treatments; the MBSR and MBTI interventions involved weekly sessions and 30-45 minutes of meditation practice at least 6 days per week, which differs from a short silent pre-bed protocol.

**Why it matters:** It is a reliable government-facing digest that makes the trial design and limitations easy to understand, but it should not replace extraction from the underlying primary RCT.

**Potential experiment signals:** total wake time; pre-sleep arousal; insomnia severity; patient-reported sleep quality; sleep diary outcomes

**Protocol takeaway:** Use as secondary clinical-context evidence only; it reinforces that structured mindfulness programs may help chronic insomnia symptoms but does not isolate a silent meditation immediately before bed.

**Claim use:** `context-only`.
