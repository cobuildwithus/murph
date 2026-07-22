---
schemaVersion: "murph.commons.page.v1"
entityType: "protocol_variant"
key: "protocol_variant:social-media-abstinence/social-media-fast"
slug: "protocols/social-media-abstinence/social-media-fast"
title: "Social Media Fast"
summary: "A bounded 24-hour, 72-hour, or 7-day break from chosen social media apps while tracking mood, connection, urges, sleep context, and life-fit."
status: "draft"
quality: "usable"
hidden: true
aliases: 
  - "social media break"
  - "social media abstinence"
  - "one-week social media break"
  - "social media detox"
categories: 
  - "attention"
  - "mood"
  - "sleep-context"
  - "digital-life"
  - "behavior-change"
  - "murph-canonical"
media: 
  - kind: "image"
    relativePath: "design-assets/hero-social-media-fast.jpeg"
    mediaType: "image/jpeg"
    caption: "Social Media Fast"
relations: 
  - type: "parent_family"
    target: "experiment_family:social-media-abstinence"
  - type: "primary_biomarker"
    target: "biomarker:self-reported-mood"
  - type: "secondary_biomarker"
    target: "biomarker:perceived-stress"
  - type: "secondary_biomarker"
    target: "biomarker:total-sleep-time"
  - type: "secondary_biomarker"
    target: "biomarker:sleep-quality"
  - type: "safety_outcome"
    target: "biomarker:adverse-symptoms"
  - type: "cites"
    target: "source_artifact:pmid-35512731"
  - type: "cites"
    target: "source_artifact:pmid-32599962"
  - type: "cites"
    target: "source_artifact:pmid-31402459"
  - type: "cites"
    target: "source_artifact:doi-10-1007-s41347-020-00189-w"
  - type: "cites"
    target: "source_artifact:pmid-40038410"
  - type: "cites"
    target: "source_artifact:kolas-2024-ch7-sns-72h-abstinence"
  - type: "cites"
    target: "source_artifact:doi-10-1037-ppm0000583"
  - type: "cites"
    target: "source_artifact:pmid-30334650"
  - type: "cites"
    target: "source_artifact:pmid-29558267"
  - type: "cites"
    target: "source_artifact:pmid-27831756"
  - type: "cites"
    target: "source_artifact:pmid-31851833"
lineage: 
  relationship: "root"
  rationale: "Default Murph bounded social media abstinence variant, kept separate from Digital Sunset, generic screen-time reduction, full smartphone abstinence, app-blocker tooling, notification-only changes, productivity or dopamine-detox framing, and clinician-led problematic-use treatment."
attribution: 
  ownerType: "murph"
  note: "Synthesized from the Social Media Fast research workflow completed in May 2026 using valid saved-lane review-gpt reruns, recovered snowball/gap-fill, and staged source extraction outputs."
protocol: 
  doseSignature: "One bounded break from selected social media apps for 24 h, 72 h, or 7 d; exceptions and stop conditions defined before start."
  target: "selected social media apps only, with direct messaging, work, school, caregiving, emergency, and logistics channels allowed when needed"
  frequency: 
    sessionsPerWeek: 1
  durationMinutes: 
    min: 1440
    max: 10080
  sessionShape: 
    label: "Fast window"
    segments: 
      - label: "selected-app abstinence"
        kind: "stimulus"
        durationMinutes: 10080
    ticks: 
      - label: "start"
        offsetMinutes: 0
      - label: "24 h"
        offsetMinutes: 1440
      - label: "72 h"
        offsetMinutes: 4320
      - label: "7 d"
        offsetMinutes: 10080
  interventionSessionsMinimum: 1
  interventionSessionsTarget: 1
  steps: 
    - "Choose 24 hours, 72 hours, or 7 days before starting; do not auto-extend based on willpower or early mood changes."
    - "List the apps that count and the channels that remain allowed for work, school, caregiving, emergencies, logistics, and direct support."
    - "Keep the break to the chosen apps; do not replace the fast with browser checking, alternate accounts, or another feed."
    - "Log app minutes, mood, anxiety or stress, connectedness, FoMO or urge to check, boredom, sleep context, and anything that made the fast materially harder."
    - "Stop or soften the fast if it creates unsafe isolation, missed urgent communication, worsening mood, or compulsive distress."
  safetyNotes: 
    - "This is a bounded self-experiment, not discipline, productivity training, dopamine detox, or treatment for problematic use."
    - "People relying on social media for support, care coordination, safety, work, school, or harassment documentation need explicit exceptions or a lower-burden variant."
    - "The evidence is mixed; treat any benefit, burden, or null result as useful signal rather than proof of a universal effect."
  tips: 
    - "Start with 24 hours when communication risk or burden is high."
    - "Use 72 hours as a sparse pragmatic middle dose, not as an evidence-proven sweet spot."
    - "Use 7 days when the user wants a clearer signal and can protect support and logistics channels."
  keepInMind: 
    - "One-week evidence is direct but mixed, with positive, null, and negative or burden findings."
    - "Short-break evidence is weaker and may include social-relatedness or day-satisfaction costs."
    - "The recovered 72-hour source is small unpublished grey literature and should not carry efficacy claims by itself."
  logFields: 
    - "duration choice"
    - "apps included"
    - "allowed exceptions"
    - "baseline daily minutes"
    - "actual app minutes"
    - "mood"
    - "anxiety or stress"
    - "loneliness or connectedness"
    - "FoMO or urge to check"
    - "boredom"
    - "sleep context"
    - "missed communication"
    - "work or care conflict"
    - "substitution behavior"
    - "stop or soften reason"
  stopConditions: 
    - "Stop or soften if the fast causes unsafe isolation, missed urgent communication, worsening mood, compulsive distress, or material work, school, caregiving, or safety problems."
testPlans: 
  - planId: "social-media-fast-7d"
    durationDays: 21
    baselineDays: 14
    interventionDays: 7
    primaryBiomarkerKey: "biomarker:self-reported-mood"
    secondaryBiomarkerKeys: 
      - "biomarker:perceived-stress"
      - "biomarker:total-sleep-time"
      - "biomarker:sleep-quality"
    safetyOutcomeKeys: 
      - "biomarker:adverse-symptoms"
    minimumAdherenceSessions: 1
    targetAdherenceSessions: 1
    notes: 
      - "Use a 14-day baseline when practical, then one selected 24 h, 72 h, or 7 d fast window. Preserve null, mixed, and burden findings."
expectedSignalDescriptions: 
  - biomarkerKey: "biomarker:self-reported-mood"
    expected: "Could go either way"
    expectedDirection: "mixed_or_contextual"
    protocolProminence: "focus"
    description: "Mood or affect may improve, worsen, or stay unchanged depending on person, platform role, social context, and dose."
  - biomarkerKey: "biomarker:perceived-stress"
    expected: "May rise at first"
    expectedDirection: "mixed_or_contextual"
    protocolProminence: "context"
    description: "Stress, FoMO, boredom, and urge to check are part of the result, not protocol failures."
  - biomarkerKey: "biomarker:total-sleep-time"
    expected: "Small or no change"
    expectedDirection: "mixed_or_contextual"
    protocolProminence: "context"
    description: "Sleep can be logged as context, but this protocol is not a bedtime-only screen intervention."
claims: 
  - claimId: "one-week-evidence-mixed"
    type: "mixed_evidence"
    text: "One-week social media abstinence has direct evidence, but the balance is mixed across positive, null, and negative or burden signals."
    strength: "moderate"
    sourceKeys: 
      - "source_artifact:pmid-35512731"
      - "source_artifact:pmid-32599962"
      - "source_artifact:pmid-31402459"
      - "source_artifact:pmid-40038410"
  - claimId: "short-break-caution"
    type: "evidence_scope"
    text: "Short 24-hour style social media breaks should be framed as low-burden experiments rather than proven well-being interventions."
    strength: "low"
    sourceKeys: 
      - "source_artifact:doi-10-1007-s41347-020-00189-w"
  - claimId: "seventy-two-hour-grey-literature"
    type: "evidence_scope"
    text: "A 72-hour SNS abstinence source exists, but it is small unpublished grey literature with mostly null or mixed effects and useful burden and adherence signals."
    strength: "low"
    sourceKeys: 
      - "source_artifact:kolas-2024-ch7-sns-72h-abstinence"
safety: 
  cautionLevel: "moderate"
  avoidOrGetClinicianGuidance: 
    - "Active crisis, unsafe isolation risk, reliance on social media for care, safety, or work logistics, or distress that feels compulsive or escalating."
  stopIf: 
    - "Unsafe isolation, missed urgent communication, worsening mood, compulsive distress, or material work, school, caregiving, or safety problems."
  notes: 
    - "Keep direct support and logistics channels allowed when needed."
---
# Social Media Fast

A Social Media Fast is a bounded self-experiment: choose the apps that count, take a full break for 24 hours, 72 hours, or 7 days, and track whether life feels clearer, harder, lonelier, calmer, or unchanged.

## Evidence Stance

The evidence is mixed. A one-week fast has direct evidence, including positive RCT/pre-post findings and direct null or negative findings. A 24-hour fast is lower burden but has weaker support and possible social-relatedness costs. The 72-hour variant now has one direct but small unpublished thesis-chapter source with null/mixed findings, so it remains a sparse pragmatic option rather than a proven dose. Cite this as uncertainty, not as a guaranteed benefit. [source_artifact:pmid-35512731], [source_artifact:pmid-32599962], [source_artifact:pmid-31402459], [source_artifact:doi-10-1007-s41347-020-00189-w], [source_artifact:pmid-40038410], [source_artifact:kolas-2024-ch7-sns-72h-abstinence]

## Protocol

- Choose a duration: 24 hours, 72 hours, or 7 days.
- List the apps that count before starting.
- Keep direct messaging, work, school, caregiving, emergency, and logistics channels allowed if needed.
- Do not replace the fast with constant checking through a browser, alternate account, or another feed.
- Log app minutes, mood, anxiety/stress, loneliness or connectedness, FoMO/urge to check, boredom, sleep context, and anything that made the fast materially harder.
- Stop or soften the fast if it creates unsafe isolation, missed urgent communication, worsening mood, or compulsive distress.

## Claims

1. A 7-day social media fast may improve well-being or distress for some users, but direct evidence is mixed and should be presented with null and negative findings. Sources: [source_artifact:pmid-35512731], [source_artifact:pmid-32599962], [source_artifact:pmid-31402459], [source_artifact:pmid-40038410]
2. Short breaks are not proven well-being upgrades and may carry small social-relatedness or day-satisfaction costs. Sources: [source_artifact:doi-10-1007-s41347-020-00189-w]
3. A 72-hour SNS fast has one direct small grey-literature source with mostly null/mixed signals and first-day burden notes; treat it as sparse context, not efficacy proof. Sources: [source_artifact:kolas-2024-ch7-sns-72h-abstinence]
4. Burden is part of the protocol signal, especially FoMO, boredom, craving, loneliness, social pressure, and missed communication. Sources: [source_artifact:pmid-30334650], [source_artifact:doi-10-1037-ppm0000583], [source_artifact:pmid-29558267], [source_artifact:pmid-31402459], [source_artifact:kolas-2024-ch7-sns-72h-abstinence]
5. Platform-specific studies should stay platform-specific. Facebook and Instagram findings do not automatically generalize to every feed or messaging-adjacent app. Sources: [source_artifact:pmid-27831756], [source_artifact:pmid-31851833], [source_artifact:pmid-29558267]

## Research Landscape

- Direct abstinence: one-week and short-break studies of general social media abstinence.
- Direct sparse 72-hour evidence: one small unpublished thesis chapter on SNS abstinence versus usual SNS use.
- Platform-specific abstinence: Facebook or Instagram studies.
- Adjacent context: time caps, bedtime phone limits, social media restriction, problematic-use treatment, and observational studies.
- Recovery status: failed extraction batches 004-005 were recovered through smaller valid reruns; the failed snowball seam was recovered by a valid zero-or-one retry and one-source extraction.

## Safety

Do not frame this as discipline, productivity, dopamine, or moral self-control. The fast should be easy to stop. Screen for work/care obligations, reliance on social support, active relationship stress, mood instability, body-image vulnerability, harassment contexts, and problematic-use concerns before starting.

## Experiment Onboarding

Ask for duration, app list, allowed exceptions, baseline daily minutes, expected hard moments, primary outcome, stop conditions, and the first check-in time. Prefer the 24-hour variant when burden or communication risk is high.
