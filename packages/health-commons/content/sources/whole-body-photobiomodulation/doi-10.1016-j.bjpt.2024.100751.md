---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1016-j.bjpt.2024.100751
slug: sources/whole-body-photobiomodulation/doi-10.1016-j.bjpt.2024.100751
title: "Acute effect of whole-body photobiomodulation on agility test in trained and healthy individuals: preliminary study"
summary: Preliminary crossover conference abstract found no advantage of acute whole-body PBM over placebo on agility despite a within-condition improvement versus baseline.
status: draft
quality: usable
aliases:
  - 10.1016/j.bjpt.2024.100751
  - doi-10.1016-j.bjpt.2024.100751
categories:
  - whole-body-photobiomodulation
relations:
  -
    type: related_protocol
    target: protocol_variant:whole-body-photobiomodulation/whole-body-red-and-near-infrared-light-exposure
  -
    type: parent_family
    target: experiment_family:whole-body-photobiomodulation
source:
  kind: other
  title: "Acute effect of whole-body photobiomodulation on agility test in trained and healthy individuals: preliminary study"
  authors: Guilherme V. dos Santos, Ítalo A. de Oliveira, Camila M. Scontri, Orivaldo B. Dutra, Lívia M. B. Espósito, Claudia Ferraresi
  year: 2024
  journal: Brazilian Journal of Physical Therapy
  citation: "dos Santos GV, de Oliveira ÍA, Scontri CM, Dutra OB, Espósito LMB, Ferraresi C. Acute effect of whole-body photobiomodulation on agility test in trained and healthy individuals: preliminary study. Braz J Phys Ther. 2024;28(Suppl 1):100751. doi:10.1016/j.bjpt.2024.100751."
  doi: 10.1016/j.bjpt.2024.100751
  url: https://www.sciencedirect.com/science/article/pii/S141335552400162X
researchEvidence:
  designKind: acute_mechanistic
  designLabel: Randomized double-blind crossover placebo-controlled preliminary study
  participantCount: 10
  participantCountKind: reported
  populationLabel: Young trained healthy adults
  durationLabel: Two pre-test exposures within 6 hours of agility testing; 7-day washout
  aggregateRole: primary
  cohortKey: dos-santos-2024-agility-preliminary
protocolEvidence:
  -
    protocolKey: protocol_variant:whole-body-photobiomodulation/whole-body-red-and-near-infrared-light-exposure
    groupId: acute-agility-preliminary
    stance: mixed
    scope: adjacent_variant
    result: no_clear_advantage
    headline: Acute whole-body PBM did not outperform placebo on the Illinois Agility Test in a preliminary trained-participant crossover study.
    implication: Useful for recall of an abstract-only implementation variant and for preserving another null performance result.
    caveat: Conference supplement abstract with only 10 participants and limited methodological detail.
    displayPriority: 30
evidenceBucket: Exercise-timed whole-body PBM sibling variant
whyItMatters: This abstract-only record broadens source recall and preserves another negative acute-performance signal that should not be lost.
potentialMurphEndpoints:
  - agility time
  - muscle performance
  - acute pre-test timing
protocolTakeaway: Keep as low-confidence adjacent-variant evidence showing no placebo-controlled agility advantage.
murphTakeaway: Useful mainly for recall and for tracing an emerging implementation branch that did not show clear performance benefit.
studyDesign: Randomized double-blind crossover placebo-controlled preliminary study
modality: Acute whole-body PBM before agility testing
claimUse: context-only
murphV1Priority: Medium
pdfRightsStatus: unknown
---

This source is included for **Exercise-timed whole-body PBM sibling variant**.

**Findings:** This preliminary conference abstract describes a randomized double-blind crossover study in 10 trained healthy young adults. Participants received two whole-body PBM exposures, one 6 hours before and one 5 minutes before agility assessment, at about 13.85 J/cm^2 and 46.17 mW/cm^2. The main placebo-controlled result was null: active PBM did not outperform placebo on the Illinois Agility Test (p=0.963). The active condition did improve from baseline, but placebo did not, which leaves the between-condition null as the more important boundary signal. The authors estimated that a larger sample would be needed for a better-powered trial.

**Why it matters:** It preserves an otherwise easy-to-miss emerging whole-body PBM variant and adds another null athlete-performance data point.

**Potential experiment signals:** Illinois Agility Test, acute timing, placebo contrast, sample size needs.

**Protocol takeaway:** Treat as low-confidence adjacent-variant evidence and do not elevate it above the peer-reviewed studies.

**Claim use:** `context-only`.
