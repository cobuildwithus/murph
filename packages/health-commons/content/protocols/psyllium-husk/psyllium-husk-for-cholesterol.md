---
schemaVersion: "murph.commons.page.v1"
entityType: "protocol_variant"
key: "protocol_variant:psyllium-husk/psyllium-husk-for-cholesterol"
slug: "protocols/psyllium-husk/psyllium-husk-for-cholesterol"
title: "Psyllium Husk For Cholesterol"
summary: "A lab-measured cholesterol experiment using daily psyllium husk as a diet adjunct, aiming primarily at LDL-C while tracking non-HDL-C, ApoB, and total cholesterol as companion lipid labs with hydration, swallowing, allergy, medication-spacing, and lab-follow-up guardrails."
status: "draft"
quality: "usable"
hidden: false
aliases:
  - "psyllium husk for cholesterol"
  - "psyllium for LDL cholesterol"
  - "psyllium fiber for LDL-C"
  - "psyllium soluble fiber for cholesterol"
  - "psyllium seed husk for cholesterol"
  - "ispaghula husk for cholesterol"
  - "isabgol for cholesterol"
  - "Plantago ovata fiber for LDL-C"
  - "psyllium hydrophilic mucilloid for hypercholesterolemia"
categories:
  - "cholesterol"
  - "lipids"
  - "soluble-fiber"
  - "cardiovascular"
  - "lab-measured"
  - "diet-adjunct"
media:

  -
    kind: image
    relativePath: design-assets/hero-03.png
    mediaType: image/png
    caption: Psyllium Husk For Cholesterol
relations:

  -
    type: "parent_family"
    target: "experiment_family:psyllium-husk"
  -
    type: "primary_biomarker"
    target: "biomarker:ldl-c"
  -
    type: "secondary_biomarker"
    target: "biomarker:non-hdl-c"
  -
    type: "secondary_biomarker"
    target: "biomarker:apolipoprotein-b"
  -
    type: "secondary_biomarker"
    target: "biomarker:total-cholesterol"
  -
    type: "secondary_biomarker"
    target: "biomarker:triglycerides"
  -
    type: "secondary_biomarker"
    target: "biomarker:hdl-c"
lineage:
  relationship: "root"
  rationale: "Murph canonical cholesterol-specific psyllium husk variant. It is separated from generic soluble-fiber protocols, constipation-only use, portfolio-diet protocols, diabetes/glycemic variants, pediatric protocols, and external named claims."
attribution:
  ownerType: "murph"
  note: "Built from Murph Health Commons psyllium cholesterol research outputs and source extraction batches."
protocol:
  doseSignature: "Daily · 7–10.5 g/day active psyllium husk target · divided with meals · at least 8 oz / 240 mL liquid per dose · 8–12 weeks"
  target: "LDL-C primary change plus non-HDL-C, ApoB, and total cholesterol companion labs on repeat lipid panel"
  frequency:
    sessionsPerDay: 2
    sessionsPerWeek: 14
  interventionSessionsMinimum: 112
  interventionSessionsTarget: 168
  steps:
    - "Before starting, record current lipid medications, diet pattern, weight trend, and recent cholesterol labs; get or import a baseline lipid panel with LDL-C and total cholesterol, plus non-HDL-C and ApoB if available."
    - "Choose one exact psyllium/ispaghula/Plantago ovata product and record its format, serving size, product grams, active psyllium husk grams, and soluble-fiber grams if the label provides them."
    - "If psyllium is new for you, start with one labeled serving once daily for a few days, then titrate toward the protocol target of 7–10.5 g/day active psyllium husk when tolerated."
    - "Use divided dosing rather than one dry bolus: common evidence-aligned patterns are about 5.1 g active psyllium twice daily or about 3.4 g three times daily when the product label supports that dosing."
    - "For every dose, use at least 8 oz / 240 mL of water or other liquid, or the stricter direction on the selected product label. Mix powder or granules completely and drink promptly before the mixture thickens. Do not take psyllium dry, incompletely hydrated, mixed into food as a workaround for swallowing difficulty, or right before sleep. If using capsules, swallow capsules one at a time with the full liquid amount rather than taking a handful at once."
    - "Keep dose timing consistent, preferably with meals or the same daily meal routine; do not treat morning versus evening timing as the main active variable."
    - "Separate all oral prescriptions, OTC medicines, and supplements from psyllium by at least 2 hours by default, unless a clinician or pharmacist gives product-specific timing. Get clinician/pharmacist guidance before starting if you use thyroid hormone, levodopa, lithium, carbamazepine, coumarins/anticoagulants, cardiac glycosides/digoxin, diabetes medicines, bile-acid sequestrants, mineral or vitamin B12 supplements, or any narrow-therapeutic-index or timing-sensitive drug."
    - "Keep diet, saturated-fat intake, weight-loss efforts, exercise, lipid medications, and other supplements as stable as safely possible during the test; do not delay, stop, or change clinician-directed lipid-lowering or cardiovascular-risk medication to keep the experiment clean, and log any meaningful change as a confounder or clinician-guided adaptation."
    - "Repeat a lipid panel after 8–12 weeks of stable dosing and interpret the result alongside adherence, product details, safety symptoms, and confounder notes."
  safetyNotes:
    - "Do not start unsupervised if you have swallowing difficulty/dysphagia, prior choking with powders or capsules, esophageal narrowing, bowel obstruction or narrowing, fecal impaction, severe constipation, reduced gut motility, prior GI obstruction/bezoar, or known/suspected psyllium/ispaghula/isabgol allergy or occupational sensitization."
    - "Psyllium can affect timing for oral prescriptions, OTC medicines, supplements, minerals, and vitamin B12; medication conflicts are a setup issue, not an afterthought."
    - "GI symptoms such as bloating, fullness, gas, dry stool, or stool changes are common enough to track; severe pain, vomiting, choking, swallowing symptoms, breathing symptoms, or allergic symptoms are stop signals."
  tips:
    - Powder or granules dose easiest; swallow capsules one at a time with full liquid.
    - Same product throughout the run unless a switch is logged as a confounder.
    - Pre-measure servings and keep water visible at the dosing spot.
    - "Mild bloating? Step down and titrate more slowly rather than pushing through."
    - Same lab and similar fasting conditions for baseline and follow-up.
    - "Food/cereal forms still need adequate liquid and are not a workaround for swallowing difficulty."
  keepInMind:
    - "LDL-C is the primary endpoint; non-HDL-C, ApoB, and total cholesterol are the most useful lab companions, while HDL-C and triglycerides are context metrics."
    - "This is a diet-adjunct experiment, not a replacement for lipid-lowering medication or cardiovascular-risk care; do not delay, stop, or change clinician-directed medication to preserve attribution."
    - "People with near-normal baseline cholesterol may see less change or mixed results."
    - "Regulatory health-claim eligibility and product labels are context, not proof that any individual product or dose will lower your LDL-C."
    - "Food vehicles, cereals, capsules, powders, and combination interventions should not be silently treated as equivalent."
    - "Short RCT tolerability summaries are not enough to set safety rules; label/regulatory warnings and case reports control hydration, swallowing, obstruction, allergy, and stop-rule boundaries."
  logFields:
    - "date"
    - "product_name"
    - "product_format"
    - "servings_or_capsules"
    - "active_psyllium_husk_grams"
    - "soluble_fiber_grams_if_known"
    - "dose_time"
    - "liquid_ounces"
    - "with_meal"
    - "full_partial_or_missed"
    - "medication_spacing_ok"
    - "bloating_fullness_gas"
    - "nausea_or_abdominal_pain"
    - "constipation_diarrhea_or_stool_change"
    - "choking_or_swallowing_symptoms"
    - "allergy_or_respiratory_symptoms"
    - "diet_or_saturated_fat_change"
    - "weight_change"
    - "exercise_change"
    - "lipid_medication_or_supplement_change"
    - "lab_date"
    - "fasting_status"
    - "ldl_c"
    - "total_cholesterol"
    - "non_hdl_c"
    - "apob"
    - "hdl_c"
    - "triglycerides"
    - "label_minimum_liquid_met"
    - "liquid_ounces_or_ml"
    - "mixture_drunk_promptly"
    - "mixture_thickened_before_swallowing"
    - "dry_or_incompletely_hydrated_dose"
    - "capsule_count"
    - "capsules_swallowed_one_at_a_time"
    - "product_is_granules"
    - "dose_near_bedtime"
    - "medication_spacing_minutes"
    - "oral_rx_otc_or_supplement_taken_within_spacing_window"
    - "medication_effect_change_or_timing_concern"
    - "mineral_or_vitamin_b12_supplement_timing"
    - "other_soluble_fiber_or_fiber_supplement_change"
    - "plant_sterol_stanol_or_portfolio_diet_change"
    - "alcohol_or_high_carbohydrate_intake_near_lab"
    - "acute_illness_near_lab"
    - "taste_texture_or_preparation_burden"
    - "dry_stool_or_worsening_constipation"
    - "dose_reduction_or_stop_reason"
  sessionFieldIds:
  - dose_taken
  - active_husk_grams
  - liquid_ounces
  - with_meal
  - medicine_spacing_ok
  - gi_symptoms
  - swallowing_or_allergy_symptoms
  - label_minimum_liquid_met
  - liquid_ounces_or_ml
  - mixture_drunk_promptly
  - mixture_thickened_before_swallowing
  - dry_or_incompletely_hydrated_dose
  - capsule_count
  - capsules_swallowed_one_at_a_time
  - product_is_granules
  - dose_near_bedtime
  - medication_spacing_minutes
  - oral_rx_otc_or_supplement_taken_within_spacing_window
  - medication_effect_change_or_timing_concern
  - dry_stool_or_worsening_constipation
  - dose_reduction_or_stop_reason
  stopConditions:
    - "Stop the dose and seek emergency or urgent medical help for choking, trouble swallowing, throat/chest obstruction sensation, breathing difficulty, wheezing, facial/tongue swelling, or anaphylaxis-type symptoms."
    - "Stop and get urgent clinician guidance for severe or persistent abdominal pain, vomiting, severe constipation, dry stool or constipation after inadequate liquid, no bowel movement with pain, or suspected bowel obstruction/bezoar."
    - "Pause and contact a clinician or pharmacist if medication spacing is missed, a time-sensitive medication seems less effective, glycemic control changes unexpectedly, or any high-stakes medicine schedule cannot be kept safely separated."
    - "Pause the experiment if you cannot reliably take every dose with at least 8 oz / 240 mL liquid, cannot drink mixed powder/granules promptly, or cannot swallow capsules one at a time with adequate liquid."
    - "Pause and reassess if GI symptoms remain unacceptable despite slower titration or lower dosing."
    - "Do not escalate above 10.5 g/day active psyllium husk in the ordinary self-experiment setup without clinician-guided adaptation."
testPlans:

  -
    planId: "lipid-panel-12-week"
    durationDays: 84
    baselineDays: 0
    interventionDays: 84
    primaryBiomarkerKey: "biomarker:ldl-c"
    secondaryBiomarkerKeys:
      - "biomarker:non-hdl-c"
      - "biomarker:apolipoprotein-b"
      - "biomarker:total-cholesterol"
      - "biomarker:triglycerides"
      - "biomarker:hdl-c"
    minimumAdherenceSessions: 112
    targetAdherenceSessions: 168
    notes:
      - "Get a lipid panel before starting and repeat after the 84-day intervention window when possible."
      - "Use LDL-C as the primary outcome; use non-HDL-C, ApoB, and total cholesterol as secondary lab outcomes, with triglycerides and HDL-C as context."
      - "Interpret only with product, dose, adherence, medication, diet, weight, and fasting-status notes visible."
  -
    planId: "lipid-panel-8-week-minimum"
    durationDays: 56
    baselineDays: 0
    interventionDays: 56
    primaryBiomarkerKey: "biomarker:ldl-c"
    secondaryBiomarkerKeys:
      - "biomarker:non-hdl-c"
      - "biomarker:apolipoprotein-b"
      - "biomarker:total-cholesterol"
      - "biomarker:triglycerides"
      - "biomarker:hdl-c"
    minimumAdherenceSessions: 80
    targetAdherenceSessions: 112
    notes:
      - "Use when a 12-week lab window is impractical."
      - "A shorter follow-up may be less stable; avoid interpreting it if diet, weight, or lipid medication changed materially."
expectedSignalDescriptions:

  -
    biomarkerKey: "biomarker:ldl-c"
    expected: "Could trend lower"
    expectedDirection: down
    description: "Viscous psyllium gel traps bile acids and cholesterol in the gut, forcing the liver to clear more LDL from blood."
    displayValue: "8-13 mg/dL lower"
    estimatedChange:
      kind: "absolute"
      low: -13
      high: -8
      unit: "mg/dL"
      window: "8–12 weeks"
      confidence: "moderate"
      basis: "Direct psyllium lipid syntheses report LDL-C lowering around -8.55 mg/dL to -0.33 mmol/L (~-13 mg/dL), with larger relative effects in elevated-cholesterol diet-adjunct trials."
    protocolProminence: "focus"
  -
    biomarkerKey: "biomarker:non-hdl-c"
    expected: "Could trend lower"
    expectedDirection: down
    description: "Bile-acid loss shifts liver cholesterol handling toward clearing apoB-containing particles, lowering the cholesterol carried in non-HDL fractions."
    displayValue: "10-15 mg/dL lower"
    estimatedChange:
      kind: "absolute"
      low: -15
      high: -10
      unit: "mg/dL"
      window: "8–12 weeks"
      confidence: "moderate"
      basis: "The 2018 psyllium RCT meta-analysis reported non-HDL-C -0.39 mmol/L (~-15 mg/dL); the estimate is anchored to that direct pooled result and LDL-C-aligned movement."
    protocolProminence: "focus"
  -
    biomarkerKey: "biomarker:apolipoprotein-b"
    expected: "Could trend lower"
    expectedDirection: down
    description: "Each LDL and remnant particle carries one ApoB; increased particle clearance lowers ApoB count."
    displayValue: "3-8 mg/dL lower"
    estimatedChange:
      kind: "absolute"
      low: -8
      high: -3
      unit: "mg/dL"
      window: "8–12 weeks"
      confidence: "moderate"
      basis: "The 2018 psyllium RCT meta-analysis reported ApoB -0.05 g/L, with an extracted confidence interval equivalent to roughly -8 to -3 mg/dL."
    protocolProminence: "focus"
  -
    biomarkerKey: "biomarker:total-cholesterol"
    expected: "Could trend lower"
    expectedDirection: down
    description: "LDL-C contributes heavily to total cholesterol, so LDL lowering pulls the total value down."
    displayValue: "9-15 mg/dL lower"
    estimatedChange:
      kind: "absolute"
      low: -15
      high: -9
      unit: "mg/dL"
      window: "8–12 weeks"
      confidence: "moderate"
      basis: "Direct psyllium syntheses report total-cholesterol lowering around -9.05 mg/dL to -0.375 mmol/L (~-15 mg/dL), with older hypercholesterolemia trials near a 4% reduction."
    protocolProminence: "focus"
  -
    biomarkerKey: "biomarker:triglycerides"
    expected: "Small/no reliable change"
    expectedDirection: mixed_or_contextual
    description: "Psyllium slows gut mixing and absorption but does not directly target liver triglyceride export."
    estimatedChange:
      kind: "absolute"
      low: -12
      high: 2
      unit: "mg/dL"
      window: "8–12 weeks"
      confidence: "mixed"
      basis: "The 2025 41-RCT lipid meta-analysis estimated triglycerides at -5.29 mg/dL with a confidence interval crossing zero; older direct syntheses also found no significant change."
    protocolProminence: "context"
  -
    biomarkerKey: "biomarker:hdl-c"
    expected: "Usually stable"
    expectedDirection: mixed_or_contextual
    description: "Psyllium mainly changes bile-acid and LDL-particle handling, not HDL remodeling."
    estimatedChange:
      kind: "absolute"
      low: -1
      high: 2
      unit: "mg/dL"
      window: "8–12 weeks"
      confidence: "mixed"
      basis: "The 2025 41-RCT lipid meta-analysis estimated HDL-C at +0.57 mg/dL with a confidence interval crossing zero; older direct syntheses found no significant change or a small lower value."
    protocolProminence: "context"
experimentOnboarding:
  schemaVersion: "murph.commons.experiment-onboarding.v2"
  startIntent:
    displayPrompt: "Hey Murph, I want to explore doing the Psyllium Husk For Cholesterol protocol."
    intentSummary: "Explore Psyllium Husk For Cholesterol"
  safetyScreen:
    dispositionIfAnyPositive: "clinician_guidance_before_unsupervised_start"
    mustAsk:
      - id: "swallowing_or_obstruction_risk"
        prompt: "Any swallowing difficulty/dysphagia, prior choking with powders or capsules, esophageal narrowing, bowel obstruction or narrowing, fecal impaction, severe constipation, reduced gut motility, prior GI obstruction/bezoar, GI surgery or clinician-supervised bowel care?"
        ifPositive: "do_not_start_unsupervised"
      - id: "psyllium_allergy_risk"
        prompt: "Any known or suspected psyllium, ispaghula, or isabgol allergy, prior reaction to psyllium-containing foods/laxatives, or past rash, wheezing, occupational asthma, rhinitis, or anaphylaxis with fiber laxatives or psyllium dust?"
        ifPositive: "do_not_start_unsupervised"
      - id: "diagnosed_hypercholesterolemia_or_clinical_lipid_care"
        prompt: "Are you using psyllium to manage diagnosed hypercholesterolemia, known cardiovascular disease, high cardiovascular risk, or a clinician-managed lipid plan, or are you considering changing lipid medication?"
        ifPositive: "clinician_guidance_before_unsupervised_start"
      - id: "high_risk_medication_timing"
        prompt: "Do you take oral prescriptions, OTC medicines, supplements, minerals, vitamin B12, thyroid hormone, levodopa, lithium, carbamazepine, coumarins/anticoagulants, cardiac glycosides/digoxin, diabetes medicines, bile-acid sequestrants, or any medicine where absorption or timing is high stakes?"
        ifPositive: "clinician_guidance_before_unsupervised_start"
      - id: "pregnancy_pediatric_or_supervised_care"
        prompt: "Are you pregnant, lactating, under 18, or using this inside clinician-supervised cardiovascular, diabetes, bowel/GI, or lipid care?"
        ifPositive: "clinician_guidance_before_unsupervised_start"
      - id: "cannot_take_with_full_liquid"
        prompt: "Would it be hard to take every dose with at least 8 oz / 240 mL liquid, drink mixed powder/granules promptly before thickening, swallow capsules one at a time with adequate liquid, and avoid dry/incompletely hydrated or near-bedtime dosing?"
        ifPositive: "do_not_start_unsupervised"
    stopIf:
      additionalConditions:
        - "choking, breathing difficulty, or throat/chest obstruction sensation"
        - "facial/tongue swelling, wheezing, or anaphylaxis-type symptoms"
        - "severe abdominal pain, vomiting, severe constipation, dry stool with inadequate liquid, or suspected obstruction/bezoar"
        - "missed medication spacing or medication-effect concern"
        - "inability to take every dose with at least 8 oz / 240 mL liquid"
  setupSlots:
    - id: "baseline_lipid_panel_date"
      label: "Baseline lipid panel date"
      question: "If no usable lipid panel is already anchored in analysisPlan.measurementAnchors, what baseline lipid panel date should Murph use, or do you need to schedule one before starting?"
      constraints:
        optional: true
      target:
        object: "analysisPlan"
        field: "measurementAnchors"
    - id: "followup_lab_feasibility"
      label: "Follow-up lab feasibility"
      question: "Can you repeat a lipid panel after about 8 to 12 weeks of stable dosing?"
      options:
        - "yes_8_to_12_weeks"
        - "yes_8_week_minimum"
        - "not_yet"
        - "unsure"
      target:
        object: "analysisPlan"
        field: "followupLabFeasibility"
    - id: "product_format"
      label: "Product format"
      question: "What psyllium product format will you use? Food/cereal forms are not automatically equivalent to powder, granules, or capsules and still require adequate liquid; do not use food mixing as a workaround for swallowing difficulty."
      options:
        - "powder"
        - "granules"
        - "capsule"
        - "cereal_or_food"
        - "other"
        - "not_chosen"
      target:
        object: "onboardingCapture"
        field: "productFormat"
    - id: "product_serving_details"
      label: "Serving details"
      question: "From the label, what are the product grams, active psyllium husk grams, and soluble-fiber grams per serving if listed?"
      target:
        object: "onboardingCapture"
        field: "productServingDetails"
    - id: "active_husk_grams_per_day"
      label: "Active husk grams per day"
      question: "What daily active psyllium husk target should Murph track, ideally in the 7 to 10.5 g/day range if tolerated? Higher-dose attempts should be clinician-guided rather than an ordinary self-experiment."
      constraints:
        min: 0
        max: 10.5
        preferredMin: 7
        preferredMax: 10.5
        requiresClinicianGuidanceAbove: 10.5
      target:
        object: "protocol"
        field: "dose.activeHuskGramsPerDay"
    - id: "dose_schedule"
      label: "Dose schedule"
      question: "How will you split the daily dose?"
      options:
        - "twice_daily"
        - "three_times_daily"
        - "once_daily_titration_only"
        - "other"
      target:
        object: "protocol"
        field: "dose.scheduleLabel"
    - id: "medication_spacing_plan"
      label: "Medication spacing plan"
      question: "What plan will keep psyllium at least 2 hours away from all oral prescriptions, OTC medicines, and supplements, or what clinician/pharmacist advice are you following?"
      target:
        object: "onboardingCapture"
        field: "medicationSpacingPlan"
    - id: "diet_med_stability"
      label: "Diet and medication stability"
      question: "Will diet, saturated fat intake, weight-loss efforts, lipid medications, and other lipid supplements stay stable during the experiment, except for clinician-directed changes that should be followed and logged as confounders?"
      options:
        - "stable"
        - "planned_changes"
        - "unsure"
        - "clinician_directed_change"
      target:
        object: "analysisPlan"
        field: "confounderRiskCategory"
    - id: "reminder_policy"
      label: "Reminder policy"
      question: "Do you want dose reminders and a weekly adherence/safety digest, or tracking only?"
      options:
        - "none"
        - "dose_reminders"
        - "weekly_digest_only"
        - "dose_reminders_plus_weekly_digest"
      constraints:
        askWhen: "at_confirmation"
      target:
        object: "assistantSupport"
        field: "reminderPolicy"
  planDefaults:
    testPlanId: "lipid-panel-12-week"
    firstSessionGuidance: "Keep the first week boring: use one product, one dosing plan, at least 8 oz / 240 mL liquid per dose, prompt swallowing before thickening, and no simultaneous diet or lipid-medication changes unless clinician-directed."
  trackingHints:
    confounderFields:
      - "diet_change"
      - "weight_change"
      - "exercise_change"
      - "lipid_medication_change"
      - "fasting_status"
      - "illness_or_travel"
      - "mineral_or_vitamin_b12_supplement_timing"
      - "other_soluble_fiber_or_fiber_supplement_change"
      - "plant_sterol_stanol_or_portfolio_diet_change"
      - "alcohol_or_high_carbohydrate_intake_near_lab"
      - "acute_illness_near_lab"
      - "taste_texture_or_preparation_burden"
    notes:
      - "Weekly review should prioritize safety symptoms and adherence before interpreting any lipid result."
  supportHints:
    missedLogFollowupCopy: "No psyllium dose was logged for the planned window. Should Murph mark it missed, partial, or taken?"
whyItWorks:
  - "## Viscous gel traps bile acids in the gut\n\nPsyllium forms a thick gel in the intestine that binds bile acids and cholesterol, blocking reabsorption. The liver compensates by pulling LDL particles from the bloodstream to rebuild bile-acid supply. LDL-C and total cholesterol are the most consistent lipid signals across psyllium-specific trials and meta-analyses."
  - "## Daily divided dosing sustains the bile-acid drain\n\nSplitting 7-10.5 g/day of active psyllium husk across meals keeps viscous gel present throughout the day. Each dose renews the bile-acid trapping cycle rather than leaving gaps where reabsorption resumes."
  - "## Lab follow-up separates real change from noise\n\nLDL-C movement is a lab biomarker, not a same-day symptom. A baseline and 8-12 week repeat lipid panel, with product, dose, adherence, diet, weight, and medication context visible, is the only way to interpret whether the intervention shifted cholesterol handling."
mechanismChain:
  -
    label: "Dose"
    content: "7-10.5 g/day active psyllium husk · divided with meals · 8 oz liquid per dose"
  -
    label: "Acute effect"
    content: "Viscous gel forms in gut; bile acids and cholesterol trapped instead of reabsorbed"
  -
    label: "Repeated signal"
    content: "Daily bile-acid loss forces liver to upregulate LDL-receptor clearance"
  -
    label: "Adaptation"
    content: "LDL-C and total cholesterol fall over 8-12 weeks; HDL-C and triglycerides stay mostly flat"
claims:

  -
    claimId: "direct-protocol-evidence-scope"
    type: "evidence_scope"
    text: "Direct protocol evidence means psyllium, ispaghula, Plantago ovata husk, or hydrophilic mucilloid interventions with lipid endpoints; generic soluble fiber, portfolio diets, constipation-only use, and commercial claims are adjacent context."
    strength: "moderate"
    sourceKeys:
      - "source_artifact:doi-10.1016-j.jff.2023.105878"
      - "source_artifact:pmid-41366295"
      - "source_artifact:pmid-30239559"
      - "source_artifact:pmid-10648260"
      - "source_artifact:pmid-18985059"
    caveats:
      - "Adjacent fibers and combination diets may be useful context but should not be merged into the canonical psyllium cholesterol protocol."
  -
    claimId: "ldl-total-cholesterol-modest-lowering"
    type: "intervention_result"
    text: "Psyllium-specific RCT syntheses support modest LDL-C and total-cholesterol lowering in adults, with extracted summaries reporting LDL-C reductions around 0.33 mmol/L or about 7% in older hypercholesterolemia syntheses and mg/dL-scale reductions in newer dose-response analyses."
    strength: "moderate"
    sourceKeys:
      - "source_artifact:doi-10.1016-j.jff.2023.105878"
      - "source_artifact:pmid-41366295"
      - "source_artifact:pmid-30239559"
      - "source_artifact:pmid-10648260"
      - "source_artifact:pmid-18985059"
    caveats:
      - "Effects are modest, heterogeneous, and most applicable to adults with elevated baseline cholesterol; this is not a guarantee for an individual."
  -
    claimId: "best-fit-adult-hypercholesterolemia"
    type: "evidence_scope"
    text: "The best-fit population is adults with elevated LDL-C or total cholesterol using psyllium as a diet adjunct; pediatric/adolescent, pregnancy or lactation, diabetes/metabolic-syndrome, obesity or weight-loss, medication-combination/statin-adjunct, sex/hormonal-subgroup, and near-normal-lipid contexts are boundary, mixed, or supervised contexts rather than default adult self-experiment evidence."
    strength: "moderate"
    sourceKeys:
      - "source_artifact:pmid-10837282"
      - "source_artifact:pmid-10201553"
      - "source_artifact:pmid-2724486"
      - "source_artifact:pmid-3277558"
      - "source_artifact:pmid-9497178"
      - "source_artifact:pmid-15453909"
      - "source_artifact:doi-10.1111-j.1365-277x.1994.tb00423.x"
      - "source_artifact:pmid-20727237"
      - "source_artifact:pmid-15911730"
      - "source_artifact:pmid-30078477"
      - "source_artifact:cps-pediatric-dyslipidemia-2026-04-26"
      - "source_artifact:medicines-org-uk-fybogel-plain-smpc-2026-04-26"
      - "source_artifact:ncbi-lactmed-psyllium-2021-05-17"
    caveats:
      - "Do not generalize adult lipid trials into pediatric, pregnancy, lactation, or clinician-managed disease protocols."
  -
    claimId: "dose-anchor-active-husk"
    type: "design_guardrail"
    text: "A practical cholesterol-test dose anchor is 7–10.5 g/day of active psyllium/ispaghula husk, often divided as about 5.1 g twice daily or 3.4 g three times daily depending on product labeling; record soluble-fiber grams separately when the label provides them rather than treating product grams, active husk grams, and soluble-fiber grams as automatically equivalent."
    strength: "moderate"
    sourceKeys:
      - "source_artifact:pmid-10648260"
      - "source_artifact:pmid-30239559"
      - "source_artifact:pmid-10837282"
      - "source_artifact:pmid-10201553"
      - "source_artifact:pmid-2724486"
      - "source_artifact:pmid-3277558"
      - "source_artifact:pmid-2203322"
      - "source_artifact:pmid-8363164"
      - "source_artifact:pmid-9497178"
      - "source_artifact:federalregister-psyllium-granular-dosage-forms-2007-03-29"
    caveats:
      - "Track active husk grams or soluble-fiber grams from the label; product grams, spoon size, capsules, cereals, and foods are not automatically equivalent."
  -
    claimId: "lab-panel-required"
    type: "design_guardrail"
    text: "This should be a lab-lipid experiment with baseline and repeat lipid panels after roughly 8–12 weeks of stable dosing; wearables cannot measure LDL-C or total cholesterol response."
    strength: "moderate"
    sourceKeys:
      - "source_artifact:pmid-30239559"
      - "source_artifact:pmid-10648260"
      - "source_artifact:pmid-41366295"
      - "source_artifact:pmid-20413122"
      - "source_artifact:pmid-18985059"
      - "source_artifact:pmid-8363164"
      - "source_artifact:pmid-10201553"
      - "source_artifact:pmid-3277558"
      - "source_artifact:pmid-10837282"
    caveats:
      - "An 8-week minimum can be useful, but a 12-week follow-up is more conservative for a self-experiment package."
  -
    claimId: "hdl-triglyceride-not-promised"
    type: "mixed_evidence"
    text: "HDL-C and triglyceride changes are mixed or not consistently demonstrated compared with LDL-C and total cholesterol, so they should be logged as context rather than advertised as expected benefits."
    strength: "moderate"
    sourceKeys:
      - "source_artifact:pmid-41366295"
      - "source_artifact:pmid-10648260"
      - "source_artifact:pmid-18985059"
      - "source_artifact:pmid-20413122"
      - "source_artifact:pmid-9129487"
      - "source_artifact:pmid-11566640"
      - "source_artifact:pmid-18727833"
  -
    claimId: "formulation-timing-boundary"
    type: "design_guardrail"
    text: "Formulation, vehicle, and dose schedule matter; powder, cereal/food delivery, capsules, pre-meal timing, and morning-versus-evening timing should not be silently treated as equivalent interventions."
    strength: "low"
    sourceKeys:
      - "source_artifact:pmid-9311953"
      - "source_artifact:pmid-8160720"
      - "source_artifact:pmid-2173390"
      - "source_artifact:pmid-1319110"
      - "source_artifact:pmid-8172091"
      - "source_artifact:pmid-15453909"
      - "source_artifact:pmid-7830631"
      - "source_artifact:pmid-8335874"
      - "source_artifact:dailymed-psyllium-husk-capsule-2026-04-26"
    caveats:
      - "The protocol can use practical dosing options, but product/formulation details must remain logged confounders."
  -
    claimId: "full-liquid-swallowing-safety"
    type: "safety"
    text: "Every dose needs at least 8 oz / 240 mL liquid or the stricter product-label direction, prompt swallowing before thickening, no dry or incompletely hydrated use, no near-bedtime dosing, and form-specific capsule/granule precautions; people with swallowing difficulty or obstruction risk need clinician guidance before use."
    strength: "moderate"
    sourceKeys:
      - "source_artifact:cornell-law-cfr-201-319-2026-04-26"
      - "source_artifact:fda-otc-monograph-m007-laxative-2023-05-02"
      - "source_artifact:dailymed-metamucil-psyllium-label-2026-04-26"
      - "source_artifact:ecfr-21-cfr-101-17-f-2026-04-26"
      - "source_artifact:medicines-org-uk-fybogel-plain-smpc-2026-04-26"
      - "source_artifact:ema-plantaginis-ovatae-seminis-tegumentum-2026-04-26"
      - "source_artifact:ismpcanada-psyllium-choking-2025-06-24"
      - "source_artifact:dailymed-psyllium-husk-capsule-2026-04-26"
      - "source_artifact:federalregister-psyllium-granular-dosage-forms-2007-03-29"
  -
    claimId: "obstruction-choking-stop-boundary"
    type: "safety"
    text: "Rare serious choking, esophageal obstruction, bezoar, intestinal obstruction, and related case reports support strong stop conditions for swallowing difficulty, chest/throat obstruction sensation, severe abdominal pain, vomiting, or suspected obstruction."
    strength: "moderate"
    sourceKeys:
      - "source_artifact:pmid-12681118"
      - "source_artifact:pmid-6488929"
      - "source_artifact:pmid-35321163"
      - "source_artifact:pmid-29085697"
      - "source_artifact:pmid-30321826"
      - "source_artifact:pmid-37179542"
      - "source_artifact:pmid-6711534"
      - "source_artifact:pmid-25157531"
      - "source_artifact:ismpcanada-psyllium-choking-2025-06-24"
  -
    claimId: "allergy-anaphylaxis-boundary"
    type: "safety"
    text: "Psyllium allergy, occupational sensitization, asthma, urticaria, and anaphylaxis reports make known or suspected psyllium hypersensitivity a do-not-start-unsupervised boundary."
    strength: "moderate"
    sourceKeys:
      - "source_artifact:pmid-14700444"
      - "source_artifact:pmid-6736485"
      - "source_artifact:pmid-7596941"
      - "source_artifact:pmid-8792925"
      - "source_artifact:pmid-2232020"
      - "source_artifact:pmid-18564629"
      - "source_artifact:pmid-21253144"
      - "source_artifact:pmid-3156543"
      - "source_artifact:pmid-3612323"
      - "source_artifact:pmid-6696210"
      - "source_artifact:dailymed-psyllium-health-mart-label-2026-04-26"
      - "source_artifact:ema-plantaginis-ovatae-seminis-tegumentum-2026-04-26"
      - "source_artifact:medicines-org-uk-fybogel-plain-smpc-2026-04-26"
  -
    claimId: "medication-spacing-guardrail"
    type: "safety"
    text: "Separate all oral prescriptions, OTC medicines, and supplements from psyllium by at least 2 hours by default unless clinician/pharmacist guidance gives product-specific timing; high-stakes medicines, minerals, and vitamin B12 require setup-level planning."
    strength: "moderate"
    sourceKeys:
      - "source_artifact:dailymed-metamucil-psyllium-label-2026-04-26"
      - "source_artifact:dailymed-psyllium-fiber-powder-2026-04-26"
      - "source_artifact:medicines-org-uk-fybogel-plain-smpc-2026-04-26"
      - "source_artifact:pmid-30078477"
      - "source_artifact:pmid-15911730"
      - "source_artifact:pmid-7804477"
      - "source_artifact:pmid-22920146"
      - "source_artifact:pmid-25112783"
      - "source_artifact:pmid-9737361"
      - "source_artifact:doi-10.3109-03639049509070866"
      - "source_artifact:dailymed-psyllium-husk-capsule-2026-04-26"
      - "source_artifact:ema-plantaginis-ovatae-seminis-tegumentum-2026-04-26"
    caveats:
      - "A levothyroxine absorption study did not show significant detectable malabsorption in its setting, so the protocol should frame spacing as a conservative guardrail rather than proof of universal interaction."
  -
    claimId: "mechanism-plausible-not-settled"
    type: "mechanistic"
    text: "Viscosity, gel formation, bile-acid/sterol handling, and fermentation-related mechanisms are plausible explanations for lipid effects, but the human mechanism evidence is mixed and should not be oversold."
    strength: "low"
    sourceKeys:
      - "source_artifact:pmid-1431597"
      - "source_artifact:pmid-2827455"
      - "source_artifact:pmid-8310991"
      - "source_artifact:pmid-4584910"
      - "source_artifact:pmid-12749348"
      - "source_artifact:pmid-15261594"
      - "source_artifact:pmid-17092830"
      - "source_artifact:pmid-21736815"
      - "source_artifact:pmid-27636880"
      - "source_artifact:pmid-27863994"
  -
    claimId: "clinician-supervision-lipid-care-boundary"
    type: "safety"
    text: "Do not delay, stop, or change clinician-directed lipid-lowering or cardiovascular-risk medication to preserve a clean experiment; diagnosed hypercholesterolemia, known cardiovascular disease, high cardiovascular risk, and clinician-managed lipid plans should be clinician-guided contexts."
    strength: "moderate"
    sourceKeys:
      - "source_artifact:ema-plantaginis-ovatae-seminis-tegumentum-2026-04-26"
      - "source_artifact:pmid-17413119"
      - "source_artifact:pmid-7804477"
      - "source_artifact:pmid-15911730"
      - "source_artifact:pmid-30078477"
    caveats:
      - "Medication-care changes should be followed and logged as confounders or clinician-guided adaptations, not resisted for attribution."
  -
    claimId: "trial-tolerability-not-safety-model"
    type: "safety"
    text: "Short RCT tolerability summaries do not replace label/regulatory warnings and case reports for hydration, swallowing, obstruction, allergy, medication-spacing, and stop-rule boundaries."
    strength: "moderate"
    sourceKeys:
      - "source_artifact:pmid-41366295"
      - "source_artifact:pmid-10648260"
      - "source_artifact:dailymed-metamucil-psyllium-label-2026-04-26"
      - "source_artifact:ismpcanada-psyllium-choking-2025-06-24"
researchLandscape:
  bottomLine: "Psyllium husk has moderate direct evidence for modest LDL-C and total-cholesterol lowering when used daily as a diet adjunct, but the runnable protocol needs lab follow-up and stronger safety guardrails than efficacy wording."
  confidenceLabel: "moderate"
  primaryClaim: "Use psyllium husk as a bounded 8–12-week lab-lipid experiment centered on LDL-C and total cholesterol, not as a broad lipid, weight-loss, glucose, or cardiovascular-outcome claim."
  mainCaveat: "Evidence is heterogeneous across products, dose schedules, populations, diet backgrounds, and formulations; safety labels and case reports require hydration, swallowing, obstruction, allergy, and medication-spacing boundaries."
  groups:

    -
      id: "direct-protocol-synthesis-dose-response"
      label: "Direct psyllium lipid syntheses"
      stance: "supports"
      summary: "Meta-analyses and dose-response syntheses support modest LDL-C and total-cholesterol lowering and define the strongest source backbone for this protocol."
      sourceKeys:
        - "source_artifact:doi-10.1016-j.jff.2023.105878"
        - "source_artifact:pmid-41366295"
        - "source_artifact:pmid-30239559"
        - "source_artifact:pmid-10648260"
        - "source_artifact:pmid-18985059"
      defaultOpen: true
    -
      id: "direct-adult-lipid-trial"
      label: "Adult lipid trials"
      stance: "supports"
      summary: "Adult RCTs and controlled lipid trials generally support LDL-C and total-cholesterol endpoints, especially in elevated-cholesterol diet-adjunct settings."
      sourceKeys:
        - "source_artifact:pmid-10837282"
        - "source_artifact:pmid-10201553"
        - "source_artifact:pmid-2724486"
        - "source_artifact:pmid-3277558"
        - "source_artifact:pmid-9497178"
        - "source_artifact:pmid-20413122"
        - "source_artifact:pmid-2203322"
        - "source_artifact:pmid-8363164"
        - "source_artifact:pmid-1872664"
        - "source_artifact:pmid-2218650"
        - "source_artifact:pmid-9129487"
    -
      id: "dose-timing-formulation"
      label: "Dose, timing, and formulation"
      stance: "mixed"
      summary: "Common dose anchors cluster around 7–10.5 g/day active psyllium, but product grams, capsules, granules, cereals, powder, meal timing, and morning-versus-evening timing are not interchangeable."
      sourceKeys:
        - "source_artifact:pmid-8160720"
        - "source_artifact:pmid-2173390"
        - "source_artifact:pmid-1319110"
        - "source_artifact:pmid-8172091"
        - "source_artifact:pmid-15453909"
        - "source_artifact:pmid-7830631"
        - "source_artifact:pmid-8335874"
    -
      id: "lab-measurement-and-confounders"
      label: "Lab measurement and attribution"
      stance: "context_only"
      summary: "Baseline and follow-up lipid panels are required for interpretable Murph outcomes; diet, weight, fasting status, lipid medications, and concurrent experiments are major confounders."
      sourceKeys:
        - "source_artifact:pmid-30239559"
        - "source_artifact:pmid-10648260"
        - "source_artifact:pmid-41366295"
        - "source_artifact:pmid-20413122"
        - "source_artifact:pmid-18985059"
        - "source_artifact:pmid-8363164"
        - "source_artifact:pmid-10201553"
        - "source_artifact:pmid-3277558"
        - "source_artifact:pmid-10837282"
        - "source_artifact:pmid-20727237"
        - "source_artifact:pmid-2218650"
        - "source_artifact:pmid-15911730"
        - "source_artifact:pmid-17824470"
    -
      id: "population-mismatch-and-null-evidence"
      label: "Population mismatch and null findings"
      stance: "mixed"
      summary: "Evidence is strongest for adults with elevated cholesterol; normal-lipid, pediatric/adolescent, pregnancy/lactation, diabetes, metabolic syndrome, obesity/weight-loss, statin-adjunct, hormonal subgroup, and lifestyle-combination contexts should be marked adjacent, mixed, null, or supervised."
      sourceKeys:
        - "source_artifact:pmid-30078477"
        - "source_artifact:pmid-15911730"
        - "source_artifact:pmid-8391569"
        - "source_artifact:pmid-16988115"
        - "source_artifact:pmid-38688104"
        - "source_artifact:pmid-11566640"
        - "source_artifact:pmid-16154305"
        - "source_artifact:pmid-11912561"
        - "source_artifact:pmid-7661492"
        - "source_artifact:pmid-17824470"
        - "source_artifact:pmid-27733151"
        - "source_artifact:pmid-18727833"
        - "source_artifact:pmid-31919936"
        - "source_artifact:pmid-27891167"
        - "source_artifact:pmid-30661699"
        - "source_artifact:pmid-10500014"
        - "source_artifact:pmid-10429748"
        - "source_artifact:pmid-12209371"
        - "source_artifact:pmid-7985708"
        - "source_artifact:pmid-9747644"
        - "source_artifact:pmid-30219432"
        - "source_artifact:doi-10.1007-s12349-009-0056-1"
        - "source_artifact:pmid-19623196"
        - "source_artifact:doi-10.1016-j.jff.2023.105685"
        - "source_artifact:pmid-17935545"
        - "source_artifact:pmid-25391814"
        - "source_artifact:pmid-22848584"
        - "source_artifact:pmid-8604676"
        - "source_artifact:pmid-33861390"
        - "source_artifact:pmid-7829159"
        - "source_artifact:pmid-1995270"
        - "source_artifact:pmid-28146065"
        - "source_artifact:pmid-26561625"
        - "source_artifact:pmid-8586774"
        - "source_artifact:pmid-37163454"
        - "source_artifact:pmid-17413119"
        - "source_artifact:pmid-8456750"
        - "source_artifact:pmid-20727237"
        - "source_artifact:pmid-2543555"
        - "source_artifact:doi-10.1111-j.1365-277x.1994.tb00423.x"
    -
      id: "safety-labels-regulatory-boundaries"
      label: "Safety labels, medication timing, and tolerability boundaries"
      stance: "safety_boundary"
      summary: "Regulatory, label, medication-timing, tolerability, lactation, and adjacent safety sources set hydration, swallowing, obstruction, allergy, drug-spacing, and supervision boundaries; these are not optional efficacy claims."
      sourceKeys:
        - "source_artifact:pmid-22920146"
        - "source_artifact:pmid-25112783"
        - "source_artifact:pmid-9737361"
        - "source_artifact:ncbi-lactmed-psyllium-2021-05-17"
        - "source_artifact:cornell-law-cfr-201-319-2026-04-26"
        - "source_artifact:dailymed-metamucil-psyllium-label-2026-04-26"
        - "source_artifact:dailymed-psyllium-fiber-powder-2026-04-26"
        - "source_artifact:dailymed-psyllium-health-mart-label-2026-04-26"
        - "source_artifact:dailymed-psyllium-premier-value-label-2026-04-26"
        - "source_artifact:ecfr-21-cfr-101-17-f-2026-04-26"
        - "source_artifact:ema-plantaginis-ovatae-seminis-tegumentum-2026-04-26"
        - "source_artifact:fda-otc-monograph-m007-laxative-2023-05-02"
        - "source_artifact:federalregister-psyllium-granular-dosage-forms-2007-03-29"
        - "source_artifact:medicines-org-uk-fybogel-plain-smpc-2026-04-26"
        - "source_artifact:dailymed-psyllium-husk-capsule-2026-04-26"
        - "source_artifact:pmid-11403757"
        - "source_artifact:doi-10.3109-03639049509070866"
        - "source_artifact:pmid-10944885"
        - "source_artifact:pmid-18222665"
        - "source_artifact:pmid-7663036"
        - "source_artifact:pmid-7804477"
      defaultOpen: true
    -
      id: "serious-obstruction-choking-case-reports"
      label: "Serious choking and obstruction cases"
      stance: "safety_boundary"
      summary: "Case reports support explicit stop conditions and exclusion of unsupervised users with swallowing, esophageal, bowel narrowing, severe constipation, or obstruction risks."
      sourceKeys:
        - "source_artifact:ismpcanada-psyllium-choking-2025-06-24"
        - "source_artifact:pmid-12681118"
        - "source_artifact:pmid-25157531"
        - "source_artifact:pmid-29085697"
        - "source_artifact:pmid-30321826"
        - "source_artifact:pmid-35321163"
        - "source_artifact:pmid-37179542"
        - "source_artifact:pmid-6488929"
        - "source_artifact:pmid-6711534"
    -
      id: "allergy-anaphylaxis-occupational-sensitization"
      label: "Allergy and sensitization"
      stance: "safety_boundary"
      summary: "Case reports and labels describe psyllium allergy, occupational respiratory sensitization, asthma, urticaria, and anaphylaxis; hypersensitivity is a hard boundary."
      sourceKeys:
        - "source_artifact:pmid-14700444"
        - "source_artifact:pmid-2232020"
        - "source_artifact:pmid-6736485"
        - "source_artifact:pmid-8792925"
        - "source_artifact:pmid-18564629"
        - "source_artifact:pmid-21253144"
        - "source_artifact:pmid-3156543"
        - "source_artifact:pmid-3612323"
        - "source_artifact:pmid-6696210"
        - "source_artifact:pmid-7596941"
    -
      id: "mechanism-bile-acid-sterol-viscosity"
      label: "Mechanism context"
      stance: "context_only"
      summary: "Viscous gel formation and bile-acid/sterol handling are plausible mechanisms, but human mechanistic signals are mixed and should support explanation rather than inflate efficacy claims."
      sourceKeys:
        - "source_artifact:pmid-1431597"
        - "source_artifact:pmid-8182140"
        - "source_artifact:pmid-21736815"
        - "source_artifact:pmid-8833174"
        - "source_artifact:pmid-12514268"
        - "source_artifact:pmid-8310991"
        - "source_artifact:pmid-2827455"
        - "source_artifact:pmid-10203567"
        - "source_artifact:pmid-10958804"
        - "source_artifact:pmid-7696332"
        - "source_artifact:pmid-9649606"
        - "source_artifact:pmid-35781477"
        - "source_artifact:pmid-12221223"
        - "source_artifact:pmid-7658161"
        - "source_artifact:pmid-8656077"
        - "source_artifact:pmid-12749348"
        - "source_artifact:pmid-27863994"
        - "source_artifact:pmid-15261594"
        - "source_artifact:pmid-1943733"
        - "source_artifact:pmid-9101430"
        - "source_artifact:pmid-27636880"
        - "source_artifact:pmid-9655372"
        - "source_artifact:pmid-8039621"
        - "source_artifact:pmid-17092830"
        - "source_artifact:pmid-7876920"
        - "source_artifact:pmid-5540619"
        - "source_artifact:pmid-8656662"
        - "source_artifact:pmid-4584910"
        - "source_artifact:pmid-8246766"
    -
      id: "regulatory-guideline-external-claim-context"
      label: "Regulatory, registry, and external claim context"
      stance: "context_only"
      summary: "FDA, Health Canada, EFSA, NHLBI/TLC, NLA, registries, and external guidance can inform context and wording boundaries, but regulatory claims and unpublished protocols are not standalone Murph efficacy evidence."
      sourceKeys:
        - "source_artifact:anzctr-actrn12611000415909-2026-04-26"
        - "source_artifact:clinicaltrials-gov-nct00502047-2026-04-26"
        - "source_artifact:clinicaltrials-gov-nct01251991-2026-04-26"
        - "source_artifact:clinicaltrials-gov-nct03346733-2026-04-26"
        - "source_artifact:isrctn-isrctn14180431-2026-04-26"
        - "source_artifact:ecfr-21-cfr-101-81-2026-04-26"
        - "source_artifact:cps-pediatric-dyslipidemia-2026-04-26"
        - "source_artifact:fda-non-digestible-carbohydrates-review-2018-06-14"
        - "source_artifact:federalregister-psyllium-soluble-fiber-chd-1998-02-18"
        - "source_artifact:federalregister-psyllium-soluble-fiber-chd-proposed-rule-1997-05-22"
        - "source_artifact:health-canada-psyllium-cholesterol-2011-12-16"
        - "source_artifact:pmid-21712404"
        - "source_artifact:pmid-22084329"
        - "source_artifact:pmid-26699442"
        - "source_artifact:pmid-27712954"
        - "source_artifact:pmid-27809443"
        - "source_artifact:pmid-37271600"
        - "source_artifact:pmid-41824552"
        - "source_artifact:pmid-9193441"
        - "source_artifact:anzctr-actrn12609000888268-2026-04-26"
        - "source_artifact:clinicaltrials-gov-nct01582282-2026-04-26"
        - "source_artifact:clinicaltrials-gov-nct03741621-2026-04-26"
        - "source_artifact:clinicaltrials-gov-nct04133805-2026-04-26"
        - "source_artifact:clinicaltrials-gov-nct06188728-2026-04-26"
        - "source_artifact:clinicaltrials-gov-nct06188832-2026-04-26"
        - "source_artifact:clinicaltrials-gov-nct06789471-2026-04-26"
        - "source_artifact:clinicaltrials-gov-nct00507715-2026-04-26"
        - "source_artifact:clinicaltrials-gov-nct05825963-2026-04-26"
        - "source_artifact:fda-authorized-health-claims-ssa-2024-03-28"
        - "source_artifact:fda-dietary-fiber-qa-2024-07-25"
        - "source_artifact:lipid-org-adding-soluble-fiber-2026-04-26"
        - "source_artifact:ncbi-endotext-diet-lipids-2024-03-31"
        - "source_artifact:nhlbi-tlc-soluble-fiber-2026-04-26"
        - "source_artifact:pmid-12485966"
        - "source_artifact:pmid-24129260"
        - "source_artifact:pmid-24239922"
        - "source_artifact:pmid-28883839"
        - "source_artifact:pmid-30586774"
        - "source_artifact:pmid-31504418"
        - "source_artifact:pmid-35961755"
        - "source_artifact:doi-10.2903-j.efsa.2010.1885"
        - "source_artifact:foodstandards-pectins-blood-cholesterol-2015-10-30"
        - "source_artifact:clinicaltrials-gov-nct03370848-2026-04-26"
        - "source_artifact:doi-10.2903-j.efsa.2010.1735"
    -
      id: "adjacent-soluble-fiber-and-combination-context"
      label: "Adjacent soluble-fiber and combination contexts"
      stance: "context_only"
      summary: "Non-psyllium viscous fibers, portfolio diets, soluble-fiber comparators, food-matrix variants, and combination interventions help define boundaries but are not direct psyllium husk cholesterol evidence."
      sourceKeys:
        - "source_artifact:pmid-29807048"
        - "source_artifact:pmid-15699225"
        - "source_artifact:pmid-12876093"
        - "source_artifact:pmid-9925120"
        - "source_artifact:pmid-35929339"
        - "source_artifact:pmid-21776465"
        - "source_artifact:pmid-36796439"
        - "source_artifact:doi-10.1017-s0954422424000180"
        - "source_artifact:pmid-9311953"
        - "source_artifact:pmid-2164467"
        - "source_artifact:pmid-2992264"
        - "source_artifact:pmid-39528010"
        - "source_artifact:pmid-20459030"
        - "source_artifact:pmid-27623982"
        - "source_artifact:pmid-38309832"
        - "source_artifact:pmid-21862744"
        - "source_artifact:pmid-28356275"
        - "source_artifact:pmid-27724985"
        - "source_artifact:doi-10.1370-afm.917"
        - "source_artifact:pmid-1317928"
        - "source_artifact:pmid-20924392"
        - "source_artifact:pmid-21470820"
        - "source_artifact:pmid-25411276"
        - "source_artifact:pmid-27273067"
        - "source_artifact:pmid-34977959"
        - "source_artifact:pmid-35837742"
        - "source_artifact:pmid-39385065"
        - "source_artifact:pmid-73854"
        - "source_artifact:pmid-32378501"
        - "source_artifact:pmid-36657917"
        - "source_artifact:pmid-26026211"
        - "source_artifact:pmid-18302966"
        - "source_artifact:pmid-35449060"
        - "source_artifact:pmid-34607737"
        - "source_artifact:pmid-18842808"
        - "source_artifact:pmid-19183750"
        - "source_artifact:pmid-1310566"
        - "source_artifact:pmid-9024732"
        - "source_artifact:pmid-31828074"
safety:
  cautionLevel: "moderate"
  avoidOrGetClinicianGuidance:
    - swallowing_difficulty_or_prior_choking
    - esophageal_narrowing_or_bowel_obstruction
    - fecal_impaction_or_severe_constipation
    - reduced_gut_motility
    - psyllium_or_ispaghula_allergy
    - pregnancy_or_lactation
    - pediatric_use
    - clinician_supervised_cardiovascular_or_diabetes
    - high_stakes_medication_spacing_unable
    - unable_to_take_dose_with_adequate_liquid
  stopIf:
    - "choking, trouble swallowing, throat/chest obstruction sensation, breathing difficulty, wheezing, facial/tongue swelling, or anaphylaxis-type symptoms"
    - "severe or persistent abdominal pain, vomiting, severe constipation, dry stool or constipation after inadequate liquid, no bowel movement with pain, or suspected bowel obstruction/bezoar"
    - "missed medication spacing, medication-effect concern, unexpected glycemic-control change, or high-stakes medicine schedule that cannot be kept separated"
    - "inability to take every dose with at least 8 oz / 240 mL liquid, drink mixed powder/granules promptly, or swallow capsules one at a time with adequate liquid"
    - "GI symptoms remain unacceptable despite slower titration or lower dose"
    - "desire to escalate above 10.5 g/day active psyllium husk without clinician-guided adaptation"
  notes:
    - "Labels, full-liquid warnings, spacing guidance, and case reports are protocol boundaries — not optional fine print."
    - "Mild gas, bloating, or stool changes get logged — severe, respiratory, allergic, choking, or obstruction symptoms stop the run."
    - "Not a replacement for clinician-directed lipid care — follow and log medication changes rather than resisting them for attribution."
---
## What this protocol is

This is a **lab-measured psyllium husk cholesterol experiment**. The intended question is: after a stable period of daily psyllium husk use, does LDL-C change, with non-HDL-C, ApoB, and total cholesterol as companion lipid labs, compared with a baseline lipid panel? The evidence backbone is psyllium-specific lipid trials and syntheses, not generic fiber, constipation-only use, or broad cardiovascular-outcome claims.

## Best-fit user

Best fit is an adult with elevated LDL-C or total cholesterol who can keep diet, weight-loss efforts, exercise, lipid medications, and other lipid supplements stable long enough to get a baseline and repeat lipid panel. Pediatric/adolescent, pregnancy or lactation, diabetes/metabolic-syndrome, obesity or weight-loss, medication-combination/statin-adjunct, sex/hormonal-subgroup, and near-normal-lipid contexts should be treated as adjacent, mixed, or supervised contexts rather than silently folded into the default adult self-experiment protocol.

## Dose and format

Use active psyllium/ispaghula husk grams, not spoon size or vague serving names. The practical Murph anchor is **7–10.5 g/day active psyllium husk**, usually split across the day. Common evidence-aligned patterns include about **5.1 g twice daily** or **3.4 g three times daily**, but labels vary and product grams may not equal active husk grams or soluble-fiber grams.

Powder, granules, cereal/food vehicles, and capsules should remain explicit setup details. Capsules can be a high-burden route because many capsules may be needed to reach grams used in cholesterol studies; swallow capsules one at a time with the full liquid amount. Food/cereal forms are not automatically equivalent to powder or capsules and still require adequate liquid; do not use food mixing as a workaround for swallowing difficulty.

## Measurement plan

Use LDL-C as the primary endpoint. Non-HDL-C, ApoB, and total cholesterol are useful secondary endpoints when available. Triglycerides and HDL-C should be watched as context because findings are mixed or less consistent for this protocol.

The default test plan is an 84-day intervention, with a baseline lipid panel before the first dose and another around 8–12 weeks after stable dosing. There is no default daily baseline window for LDL-C; use a pre-intervention run-in only when the user explicitly wants daily logging before starting. The lab result is hard to interpret unless Murph can also see product, dose, adherence, lipid medication changes, diet changes, weight changes, and fasting or non-fasting status.

## Safety first

Psyllium is not a “just add fiber” experiment. For every dose, use at least 8 oz / 240 mL of water or other liquid, or the stricter direction on the selected product label. Mix powder or granules completely and drink promptly before the mixture thickens. Do not take psyllium dry, incompletely hydrated, mixed into food as a workaround for swallowing difficulty, or right before sleep. If using capsules, swallow capsules one at a time with the full liquid amount rather than taking a handful at once.

Do not use short RCT tolerability summaries as the safety model: direct lipid trials and syntheses often have limited or non-uniform adverse-event capture, so label/regulatory warnings and case reports should control hydration, swallowing, obstruction, allergy, and stop-rule boundaries.

Do not start unsupervised if you have swallowing difficulty/dysphagia, prior choking with powders or capsules, esophageal narrowing, bowel obstruction or narrowing, fecal impaction, severe constipation, reduced gut motility, prior GI obstruction/bezoar, or known/suspected psyllium/ispaghula/isabgol allergy or occupational sensitization.

Rare but serious case reports cover choking, esophageal obstruction, bezoar, intestinal obstruction, and hypersensitivity. Stop the run for choking, difficulty swallowing, breathing symptoms, allergic symptoms, severe abdominal pain, vomiting, severe constipation, or suspected obstruction.

Medication timing is part of setup. Separate all oral prescriptions, OTC medicines, and supplements from psyllium by at least 2 hours by default, unless a clinician or pharmacist gives product-specific timing. Get clinician/pharmacist guidance before starting if you use thyroid hormone, levodopa, lithium, carbamazepine, coumarins/anticoagulants, cardiac glycosides/digoxin, diabetes medicines, bile-acid sequestrants, mineral or vitamin B12 supplements, or any narrow-therapeutic-index or timing-sensitive drug.

Do not delay, stop, or change clinician-directed lipid-lowering or cardiovascular-risk medication to keep the experiment clean. If medication care changes during the run, follow the clinician plan and mark the experiment as confounded or clinician-guided rather than trying to preserve attribution.

## What not to conclude

Do not conclude that psyllium improves the whole lipid profile, lowers cardiovascular events, replaces lipid medication, works equally in normal-lipid users, or that any psyllium-containing product will match the effects of the studied dose. The supported landing claim is narrower: modest LDL-C and total-cholesterol lowering in psyllium-specific lipid trials and syntheses, with HDL-C/triglyceride findings, lower-baseline/null trials, formulation differences, and regulatory health-claim materials preserved as boundaries rather than promoted into individual-response guarantees.
