---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:kolas-2024-ch7-sns-72h-abstinence"
slug: "sources/social-media-abstinence/kolas-2024-ch7-sns-72h-abstinence"
title: "kolas_2024_ch7_sns_72h_abstinence"
summary: "Kolas 2024 Chapter Seven is safe to use only as a small, unpublished, addiction-framed thesis-chapter study of 72-hour SNS abstinence versus usual SNS use. Among 31 adult completers, it found no clear abstinence-attributable effect on craving, withdrawal, boredom/time estimation, or rage-click outcomes. Craving decreased across all participants but not significantly by detox assignment. Detox adherence was mostly successful among completers, though 38.89% reported brief SNS use and 44.44% reported first-day difficulty. The most defensible extraction is null/mixed evidence with feasibility, burden, adherence, and timing-gap signals rather than efficacy evidence."
status: "draft"
quality: "usable"
categories: 
  - "social-media-abstinence"
  - "social-media-fast"
relations: 
  - type: "parent_family"
    target: "experiment_family:social-media-abstinence"
  - type: "related_protocol"
    target: "protocol_variant:social-media-abstinence/social-media-fast"
sourceIdentity: 
  identityKind: "other"
  canonicalIdBasis: "title_hash"
  identifiers: 
    titleHash: "207a659bfcf4505c295b097dbfcdfbff700d5dfb50ae3bc9f6c8907557460091"
  identityAliases: 
    - "source_artifact:kolas-2024-ch7-sns-72h-abstinence"
    - "kolas_2024_ch7_sns_72h_abstinence"
source: 
  kind: "other"
  title: "kolas_2024_ch7_sns_72h_abstinence"
  year: 2024
  citation: "kolas_2024_ch7_sns_72h_abstinence. 2024."
researchEvidence: 
  designKind: "other"
  aggregateRole: "context"
  durationLabel: "2024"
  notes: 
    - "Imported from the Social Media Fast staged research package; preserve source-level caveats and directness notes before using for protocol claims."
---
# kolas_2024_ch7_sns_72h_abstinence

## Extracted Role

- Directness: 

```json
{
  "level": "direct_with_adjacent_addiction_framing",
  "rationale": "The intervention is a 72-hour abstinence period from social networking sites/social media with a usual-use SNS comparator, which maps directly to the protocol's 72-hour social media fast variant. The study is also framed around SNS addiction, withdrawal, relapse, and digital detox, so the population and theory are adjacent to general wellness social media fasting.",
  "notThis": [
    "not Digital Sunset",
    "not generic screen-time reduction",
    "not full smartphone abstinence",
    "not notification-only change",
    "not productivity or dopamine-detox framing",
    "not clinician-led treatment"
  ]
}
```
- Claim use: 

```json
{
  "status": "include_as_required_snowball_gap_fill_candidate",
  "safeUses": [
    "Evidence that a small unpublished thesis chapter tested 72-hour SNS abstinence versus usual SNS use.",
    "Cautious support for null/mixed findings on withdrawal, craving, boredom/time estimation, and rage-click outcomes after a 72-hour SNS abstinence assignment.",
    "Feasibility, adherence, relapse, and burden signal extraction."
  ],
  "unsafeUses": [
    "Do not use as strong efficacy evidence for social media fasting.",
    "Do not generalize to adolescents, clinical SNS addiction treatment, full smartphone abstinence, or broad mental-health benefit claims.",
    "Do not treat craving decrease as caused by abstinence because the detox-by-time interaction was not significant."
  ]
}
```
- Population: 

```json
{
  "description": "Adults at varying risk of SNS addiction recruited in person at the University of Warwick and online in Facebook community groups.",
  "initialAgreedAndBooked": 41,
  "completedSampleSize": 31,
  "femalePercent": 70.97,
  "meanAge": 40.52,
  "ageSd": 13.92,
  "atRiskSnsAddictionPercent": 45.16,
  "riskMeasure": "Bergen Social Media Addiction Survey; BSMAS score > 19 categorized as at risk.",
  "groupsCompleted": {
    "digitalDetox": {
      "n": 18,
      "femalePercent": 72.22,
      "meanAge": 44.67,
      "ageSd": 14.29,
      "atRiskSnsAddictionPercent": 61.11
    },
    "controlUsualUse": {
      "n": 13,
      "femalePercent": 69.23,
      "meanAge": 34.77,
      "ageSd": 11.54,
      "atRiskSnsAddictionPercent": 23.08
    }
  },
  "groupImbalance": "A small but significant association was identified between assigned detox group and risk of addiction, with fewer at-risk participants in the control group: X2(1, n=31)=4.41, p=.04, phi=.38."
}
```
- Intervention: 

```json
{
  "name": "72-hour abstinence from social networking sites",
  "description": "Participants assigned to the digital detox group were instructed to refrain from SNS use for the 72 hours leading up to their appointment.",
  "nCompleted": 18,
  "adherenceMonitoring": "Self-reported daily relapse survey asking whether SNS was used that day, duration in minutes, and reason for use.",
  "scopeNotes": "SNS/social media abstinence only; not verified as full phone, internet, or screen abstinence."
}
```
- Comparator: 

```json
{
  "name": "Usual SNS use",
  "description": "Participants assigned to control groups were instructed to continue using SNS as usual over the same 72-hour period.",
  "nCompleted": 13
}
```
- Duration: 

```json
{
  "interventionPeriod": "72 hours",
  "baselineTiming": "BSMAS and initial craving measure at recruitment stage before group allocation/procedure completion.",
  "followUpTiming": "After the 72-hour period, participants attended an in-person assessment at a psychology lab or local library.",
  "relapseSurveyTiming": "Detox group received a relapse survey on each day of the 72-hour detox."
}
```
- Effect direction: 

```json
{
  "overall": "null_mixed",
  "for72HourSnsFastVsUsualUse": "No reliable between-group effect attributable to 72-hour SNS abstinence was identified for craving, withdrawal, boredom/time estimation, or rage-click outcomes.",
  "craving": "Craving decreased across all participants, but this was not statistically attributable to the detox assignment.",
  "withdrawal": "No significant detox-vs-control withdrawal difference; withdrawal differences mainly tracked baseline risk status.",
  "adherence": "Mostly feasible among completers, with 61.11% reporting no SNS use and 38.89% reporting brief, limited SNS use.",
  "burden": "First-day difficulty, automatic checking impulses, app deletion to prevent use, and potential loss of SNS utility/social connection were reported.",
  "benefitSignal": "Qualitative reports included mindful focusing, liberation, less mindless scrolling, and greater engagement, but these were exploratory and not sufficient for efficacy claims.",
  "harmSignal": "No serious adverse events were verified; burden and utility/social-participation costs were present."
}
```

## Claim-Safe Summary

Kolas 2024 Chapter Seven is safe to use only as a small, unpublished, addiction-framed thesis-chapter study of 72-hour SNS abstinence versus usual SNS use. Among 31 adult completers, it found no clear abstinence-attributable effect on craving, withdrawal, boredom/time estimation, or rage-click outcomes. Craving decreased across all participants but not significantly by detox assignment. Detox adherence was mostly successful among completers, though 38.89% reported brief SNS use and 44.44% reported first-day difficulty. The most defensible extraction is null/mixed evidence with feasibility, burden, adherence, and timing-gap signals rather than efficacy evidence.

## Safety Or Burden



```json
{
  "seriousAdverseEventsReported": null,
  "burdenSignals": [
    "44.44% of detox completers reported the first day was the most difficult part of abstaining.",
    "Participants described automatic tendencies to seek out SNS; some deleted apps to stop themselves.",
    "38.89% of detox completers reported brief SNS use during the abstinence period.",
    "SNS was described as having practical and social utility; the author notes abstinence may limit societal participation.",
    "The rage-click task deliberately used unexpected delays to frustrate participants; delays and the aim of measuring frustration were disclosed at debrief, and participants were reminded of the right to withdraw data."
  ],
  "withdrawalSafetySignal": "The study did not find heightened craving or significantly higher withdrawal symptoms attributable to the 72-hour detox assignment."
}
```

## Limitations



```json
[
  "Unpublished PhD thesis chapter / grey literature; no peer-reviewed journal article for this chapter was verified in this extraction.",
  "Small completed sample: n=31 total, n=18 detox, n=13 control.",
  "Attrition or non-completion occurred after 41 individuals agreed/booked appointments, but arm-specific non-completion details were not verified.",
  "Convenience and self-selected recruitment from University of Warwick in-person recruitment and Facebook community groups.",
  "Selection bias is likely; participants who signed up may already have been prepared to give up SNS.",
  "Random assignment produced an imbalance in risk of SNS addiction, with more at-risk participants in the detox group than in the control group.",
  "Risk of SNS addiction was based on BSMAS cutoff, not clinical diagnosis.",
  "Relapse/adherence measurement was self-report; no objective app-use or device-log verification was verified.",
  "Withdrawal was assessed using a modified smartphone-withdrawal scale adapted to social media; validation for this exact adaptation was not established in the extracted chapter text.",
  "Post-period assessment after 72 hours may have missed the first-24-hour withdrawal window suggested by qualitative responses.",
  "Behavioural tasks measured laboratory boredom/frustration rather than real-world SNS use.",
  "No long-term follow-up or durable mental-health outcome assessment was verified.",
  "Multiple exploratory subgroup and qualitative analyses increase uncertainty."
]
```

## Rights



```json
{
  "artifactStatus": "Repository-hosted submitted thesis PDF.",
  "copyright": "The PDF cover states the thesis is made available online and protected by original copyright.",
  "licenseVerified": null,
  "reuseCaution": "Use citation/summary rather than redistributing large excerpts or the PDF. Refer users to the WRAP repository record and PDF URL.",
  "sourceAccessed": "Repository record and PDF were available at extraction time."
}
```
