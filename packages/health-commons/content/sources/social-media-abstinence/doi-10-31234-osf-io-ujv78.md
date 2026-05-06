---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:doi-10-31234-osf-io-ujv78"
slug: "sources/social-media-abstinence/doi-10-31234-osf-io-ujv78"
title: "Innovations in Practice: A Pilot Randomised Trial on Smartphone and Social Media Abstinence: Effects on Sleep Quality and Psychological Well-being in Adolescents"
summary: "Adjacent adolescent pilot RCT evidence only. The study can support cautious safety, burden, acceptability, and feasibility context for a demanding 21-day combined smartphone plus social media detox, including boredom, functional reliance, fear of missing out or reduced communication, incomplete adherence, low diary completion, and no recorded adverse events. It should not be used as direct evidence that 24-hour, 72-hour, or 7-day social-media-only fasts improve sleep, energy, wellbeing, or cognition, because the intervention removed smartphones and social media together, lasted 21 days, was a small underpowered preprint pilot, and post-intervention signals were not maintained at follow-up."
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
  identityKind: "scholarly_work"
  canonicalIdBasis: "doi"
  identifiers: 
    doi: "10.31234/osf.io/ujv78_v3"
source: 
  kind: "review"
  title: "Innovations in Practice: A Pilot Randomised Trial on Smartphone and Social Media Abstinence: Effects on Sleep Quality and Psychological Well-being in Adolescents"
  year: 2026
  doi: "10.31234/osf.io/ujv78_v3"
  url: "https://osf.io/tvhrm"
  citation: "Innovations in Practice: A Pilot Randomised Trial on Smartphone and Social Media Abstinence: Effects on Sleep Quality and Psychological Well-being in Adolescents. 2026."
researchEvidence: 
  designKind: "systematic_review"
  aggregateRole: "context"
  durationLabel: "2026"
  notes: 
    - "Imported from the Social Media Fast staged research package; preserve source-level caveats and directness notes before using for protocol claims."
---
# Innovations in Practice: A Pilot Randomised Trial on Smartphone and Social Media Abstinence: Effects on Sleep Quality and Psychological Well-being in Adolescents

## Extracted Role

- Directness: 

```json
{
  "classification": [
    "adjacent_smartphone_abstinence",
    "combined_smartphone_plus_social_media_abstinence",
    "not_social_media_only",
    "duration_out_of_protocol_scope_21_days"
  ],
  "rationale": "The intervention required 21 days of total smartphone abstinence plus social media abstinence across devices, so social-media-specific effects are not separable from smartphone abstinence. The 21-day duration is longer than the protocol's 24-hour, 72-hour, and 7-day social media fast variants."
}
```
- Claim use: 

```json
[
  "safety_burden_adjacent_context_only",
  "feasibility_context_only",
  "do_not_use_for_direct_social_media_fast_effectiveness_claim"
]
```
- Population: 

```json
{
  "description": "Adolescents aged 13-18 years recruited from two UK schools; all needed to own a smartphone.",
  "setting": "UK school-based sample",
  "enrolledN": 82,
  "armsN": {
    "smartphone_social_media_abstinence": 26,
    "smartphone_social_media_abstinence_with_brick_phone": 26,
    "business_as_usual_control": 30
  },
  "completedInterventionN": 71,
  "attrition": "13.4%",
  "sexOrGender": "62% female; baseline table reports 51 female, 30 male, 1 other",
  "schoolStage": {
    "lowerSecondaryAges11To16": 30,
    "upperSecondaryAges16To19": 52
  },
  "eligibility": [
    "smartphone ownership",
    "caregiver consent",
    "adolescent assent"
  ],
  "allocation": "Parallel-group pilot RCT with computer-generated block randomization; researchers were not blinded to allocation."
}
```
- Intervention: 

```json
{
  "summary": "21-day total smartphone and social media detox.",
  "arms": [
    {
      "name": "S/SM abstinence",
      "n": 26,
      "details": "Participants abstained from smartphone use for 21 days, with devices stored in a locked school office. They were instructed to refrain from social media on all devices, including tablets, laptops, and consoles. Television was permitted except for social media access such as YouTube. Gaming was permitted."
    },
    {
      "name": "S/SM abstinence with brick phone",
      "n": 26,
      "details": "Same 21-day smartphone and social media abstinence intervention, with access to a basic Nokia 110 device allowing calls and text messaging only."
    }
  ],
  "durationDays": 21,
  "socialMediaOnly": false,
  "protocolVariantMatch": "none"
}
```
- Comparator: 

```json
{
  "name": "business-as-usual control",
  "n": 30,
  "details": "Participants continued normal smartphone and social media use."
}
```
- Duration: 

```json
{
  "intervention": "21 days",
  "preTest": "3-5 days before the abstinence period",
  "postTest": "3-4 days before the end of the abstinence period",
  "followUp": "two months after post-test, with a three-week survey completion window",
  "protocolDurationVariants": [
    "not_24_hour",
    "not_72_hour",
    "not_7_day"
  ]
}
```
- Effect direction: 

```json
{
  "overall": "mixed_adjacent_short_term_signal_not_maintained",
  "selfReportedSleepDuration": "benefit_signal_post_intervention_in_both_abstinence_groups",
  "daytimeSleepiness": "benefit_signal_post_intervention_for_smartphone_social_media_abstinence_without_brick_phone",
  "sleepQuality": "no_clear_change",
  "wearableSleepDuration": "no_clear_change",
  "depressiveSymptoms": "benefit_signal_post_intervention_for_smartphone_social_media_abstinence_without_brick_phone",
  "perceivedStress": "benefit_signal_post_intervention_in_both_abstinence_groups",
  "anxietyAndNegativeMood": "improved_across_groups_non_specific",
  "positiveMoodLonelinessHRV": "no_clear_change",
  "workingMemory": "mixed_signal_limited_to_forward_corsi_and_brick_phone_arm_for_significance",
  "sustainedAttention": "no_clear_change",
  "followUp": "signals_not_maintained_at_two_months",
  "burden": "meaningful_functional_and_social_burden_signal",
  "directProtocolEffect": "not_estimable_for_social_media_only_fast_variants"
}
```

## Claim-Safe Summary

Adjacent adolescent pilot RCT evidence only. The study can support cautious safety, burden, acceptability, and feasibility context for a demanding 21-day combined smartphone plus social media detox, including boredom, functional reliance, fear of missing out or reduced communication, incomplete adherence, low diary completion, and no recorded adverse events. It should not be used as direct evidence that 24-hour, 72-hour, or 7-day social-media-only fasts improve sleep, energy, wellbeing, or cognition, because the intervention removed smartphones and social media together, lasted 21 days, was a small underpowered preprint pilot, and post-intervention signals were not maintained at follow-up.

## Safety Or Burden



```json
{
  "adverseEvents": "No adverse events were recorded.",
  "attrition": "13.4% attrition across groups.",
  "compliance": "66% reported abstaining from social media for the full 21 days.",
  "participantExperience": {
    "positive": "50%",
    "mixed": "39%",
    "negative": "11%"
  },
  "reportedChallenges": {
    "boredom": "27%",
    "functionalRelianceOnSmartphones": "48%",
    "fearOfMissingOutOrReducedCommunication": "36%"
  },
  "dataCollectionBurden": "Daily diary completion was low, with approximately 40% valid data each week.",
  "interpretation": "Burden signals apply to a 21-day complete smartphone plus social media abstinence protocol in adolescents and should not be assumed for shorter social-media-only fasts."
}
```

## Limitations



```json
[
  "Preprint status; not peer reviewed.",
  "Pilot RCT was not powered to detect statistically significant between-group outcome differences.",
  "Convenience sampling and self-selection likely biased the sample.",
  "Only two UK schools were included, limiting generalizability.",
  "Researchers were not blinded to study-arm allocation.",
  "Intervention combined smartphone abstinence with social media abstinence, so social-media-specific effects are not separable.",
  "Duration was 21 days, outside the 24-hour, 72-hour, and 7-day protocol scope.",
  "Many outcomes relied on self-report.",
  "Wearable outcome sample sizes were smaller because of missing data.",
  "Daily diary data were too incomplete for analysis.",
  "Compliance was assessed by questionnaire rather than objective device/app monitoring.",
  "Gaming was permitted and not restricted during abstinence.",
  "Effects observed at post-intervention were not maintained at two-month follow-up.",
  "Follow-up mode differed by school, with one remote and one in person."
]
```

## Rights



```json
{
  "artifactType": "OSF/PsyArXiv preprint PDF",
  "access": "PDF available through OSF download endpoint during extraction.",
  "license": "CC BY 4.0 reported in indexed metadata.",
  "dataAvailability": "De-identified quantitative data and code reported available at https://osf.io/tvhrm.",
  "qualitativeDataAvailability": "Qualitative data not publicly available due to sensitive and identifiable pilot-study content.",
  "conflicts": "Authors report no conflicts of interest.",
  "funding": "Funded by an ECR Pilot Project Grant from the Huo Family Foundation awarded to Emma C. Sullivan.",
  "ethics": "Department of Psychology Ethics Committee, University of York, approval identification number 202478, dated 2025-02-06.",
  "artifactCaution": "Versioned DOI should be used for this record: 10.31234/osf.io/ujv78_v3."
}
```
