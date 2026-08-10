---
schemaVersion: murph.commons.page.v1
entityType: experiment_family
key: experiment_family:recovery-modalities
slug: families/recovery-modalities
title: Recovery Modalities
summary: Source-backed context for comparing passive recovery methods without treating soreness relief, wearable scores, performance recovery, and training adaptation as the same outcome.
status: reviewed
quality: usable
aliases:
  - recovery methods
  - recovery tools
  - massage recovery
  - sports massage
  - foam rolling
  - percussion gun
  - massage gun
  - percussive massage
  - contrast therapy
  - recovery score
categories:
  - recovery
  - training
  - soreness
familyKind: modality
relations:
  - type: child_family
    target: experiment_family:sauna
  - type: child_family
    target: experiment_family:cold-water-immersion
  - type: child_family
    target: experiment_family:intermittent-pneumatic-compression
  - type: child_family
    target: experiment_family:static-stretching
  - type: cites
    target: source_artifact:pmid-29755363
  - type: cites
    target: source_artifact:pmid-39376896
  - type: cites
    target: source_artifact:pmid-25760154
  - type: cites
    target: source_artifact:pmid-31681002
claims:
  - claimId: perceived-versus-performance-recovery
    type: mixed_evidence
    text: A recovery method can reduce soreness or perceived fatigue without improving objective performance recovery, tissue repair, or long-term training adaptation. A better wearable recovery score also does not prove better adaptation.
    strength: high
    sourceKeys:
      - source_artifact:pmid-29755363
      - source_artifact:pmid-39376896
  - claimId: massage-and-cold-context
    type: mixed_evidence
    text: Massage and cold exposure can support perceived recovery in some post-exercise settings, but results vary by endpoint and protocol. They should not be presented as universal performance-recovery methods.
    strength: moderate
    sourceKeys:
      - source_artifact:pmid-29755363
      - source_artifact:pmid-39376896
  - claimId: foam-rolling-context
    type: mixed_evidence
    text: Foam rolling can help short-term soreness or range of motion in some exercise settings, but this does not establish faster tissue repair or guaranteed performance recovery.
    strength: moderate
    sourceKeys:
      - source_artifact:pmid-31681002
      - source_artifact:pmid-35298696
  - claimId: percussive-massage-context
    type: mixed_evidence
    text: Percussive massage did not improve 72-hour performance recovery over passive rest in one small post-exercise trial. Device comfort or preference should not be converted into a performance guarantee.
    strength: moderate
    sourceKeys:
      - source_artifact:pmid-39376896
---

This knowledge-only parent helps Murph compare recovery methods. Specific sauna, cold-water, compression, and stretching questions should resolve to their more specific Health Commons families.
