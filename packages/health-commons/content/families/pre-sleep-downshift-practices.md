---
schemaVersion: murph.commons.page.v1
entityType: experiment_family
key: experiment_family:pre-sleep-downshift-practices
slug: families/pre-sleep-downshift-practices
title: Pre-Sleep Downshift Practices
summary: Gentle pre-bed routines that aim to reduce cognitive, emotional, autonomic, or respiratory activation before sleep, while keeping clinical insomnia care, devices, apps, CBT-I, and high-intensity breathwork as separate variants.
status: draft
quality: usable
aliases:
  - bedtime downshift practices
  - pre-sleep relaxation practices
  - pre-sleep arousal reduction
  - bedtime nervous-system downshift
  - sleep wind-down practices
categories:
  - sleep
  - pre-sleep
  - relaxation
  - breathwork
  - meditation
  - nervous-system-downshift
familyKind: mechanism
canonicalMechanism: pre_sleep_arousal_downshift
relations:
  -
    type: related_protocol
    target: protocol_variant:pre-sleep-downshift-practices/pre-sleep-silent-meditation
  -
    type: related_protocol
    target: protocol_variant:pre-sleep-downshift-practices/pre-sleep-resonance-breathing-and-meditation
  -
    type: primary_biomarker
    target: biomarker:sleep-onset-latency
  -
    type: secondary_biomarker
    target: biomarker:pre-sleep-arousal
  -
    type: secondary_biomarker
    target: biomarker:sleep-efficiency
  -
    type: secondary_biomarker
    target: biomarker:hrv-rmssd
researchCoverage:
  auditCutoff: 2026-04-26
  sourceDirectory: packages/health-commons/content/sources/pre-sleep-downshift-practices
  artifactManifest: packages/health-commons/content/artifacts/pre-sleep-downshift-practices/research-artifacts.json
  silentMeditationSourceLedger: output-packages/research/pre-sleep-silent-meditation/downloads/11-source-ledger-reducer/canonical_source_ledger_v1.json
---

Pre-sleep downshift practices are low-intensity routines used near bedtime to reduce the feeling of being wired, keyed-up, cognitively activated, or physiologically revved before sleep. This family includes gentle slow or resonance-like breathing, silent meditation, and other simple wind-down routines only when they can be tested without collapsing materially different interventions together.

This family should not teach that all relaxation practices are interchangeable. CBT-I, mindfulness-based therapy programs, app-guided meditation, body-scan or music bundles, VR, huggable or robotic devices, HRV-biofeedback, taVNS, clinical sleep-disorder treatment, sleep medication decisions, forceful breathwork, deliberate breath retention, high-ventilation practices, and commercial sleep programs should remain separate pages or adjacent variants unless a source directly tests a matching separable arm.

The family’s default posture is conservative. Treat safety and protocol-boundary evidence as stronger than efficacy language when the directness is limited. For landing pages, phrase the practical goal as a personal test of whether a repeatable pre-bed routine reduces sleep-onset friction or subjective pre-sleep arousal, not as a proven method to increase deep sleep, cure insomnia, or optimize HRV.

Safety boundaries should be stronger than efficacy language for this family. Persistent or impairing insomnia, suspected or diagnosed obstructive sleep apnea, PAP treatment questions, hypersomnolence or drowsy-driving risk, restless legs or disruptive limb movements, parasomnias, circadian rhythm sleep-wake disorders, pregnancy/postpartum/lactation sleep concerns, pediatric/adolescent sleep concerns, older-adult medical complexity or polypharmacy, panic/respiratory conditions, trauma/dissociation, psychosis/mania vulnerability, severe depression, suicidality, and medication changes should route to clinical care or separate clinician-guided variants rather than an ordinary wellness experiment. Source anchors: `source_artifact:healthquality-va-gov-insomnia-osa-cpg-2025-04-22`, `source_artifact:pmid-19960649`, `source_artifact:pmid-34743789`, `source_artifact:pmid-39324694`, `source_artifact:pmid-31271339`, `source_artifact:pmid-35419652`, `source_artifact:pmid-35659076`, `source_artifact:pmid-24347088`, `source_artifact:pmid-8680700`, `source_artifact:pmid-39883728`, and `source_artifact:pmid-41176868`.
