---
schemaVersion: murph.commons.page.v1
entityType: protocol_variant
key: protocol_variant:high-protein-intake/protein-floor-high-protein-intake
slug: protocols/high-protein-intake/protein-floor-high-protein-intake
title: High Protein Intake
summary: A daily protein floor from real food, where enough amino acids at each meal keeps muscle repair supplied and digestion slow enough to stay full longer.
status: field-testing
quality: usable
aliases:
- Protein Floor
- high-protein intake target
- 1.5 g/kg/day protein
- 1.6 g/kg/day protein
- 2.0 g/kg/day protein
categories:
- nutrition
- diet
- protein
- body-composition
- satiety
- murph-canonical
media:

  -
    kind: image
    relativePath: design-assets/hero-high-protein-intake.jpeg
    mediaType: image/jpeg
    caption: High Protein Intake
relations:
-
  type: parent_family
  target: experiment_family:high-protein-intake
-
  type: primary_biomarker
  target: biomarker:body-weight
-
  type: secondary_biomarker
  target: biomarker:body-fat-percent
-
  type: secondary_biomarker
  target: biomarker:lean-mass
-
  type: secondary_biomarker
  target: biomarker:subjective-satiety
-
  type: secondary_biomarker
  target: biomarker:triglycerides
-
  type: secondary_biomarker
  target: biomarker:ldl-c
-
  type: secondary_biomarker
  target: biomarker:blood-pressure
-
  type: secondary_biomarker
  target: biomarker:digestive-comfort
-
  type: secondary_biomarker
  target: biomarker:serum-creatinine
-
  type: secondary_biomarker
  target: biomarker:estimated-gfr
-
  type: cites
  target: source_artifact:high-protein-intake-bibliography
lineage:
  relationship: root
  rationale: Default Murph protein-floor variant for a food-first daily 1.5–2.0 g/kg/day target, kept separate from ketogenic diets, supplement-only protocols, protein pacing, resistance-training cointerventions, athlete cutting, pregnancy nutrition, and renal clinical nutrition.
attribution:
  ownerType: murph
  note: Drafted from the High Protein Intake research package and canonical source ledger.
protocol:
  doseSignature: daily · 1.5–2.0 g/kg/day protein floor · food-first, supplement-assisted only as needed · 7–14 day baseline + 8-week intervention
  target: Reach a declared 1.5–2.0 g/kg/day target using a declared denominator. Default to 1.5–1.6; use 1.8–2.0 only with a negative screen, suitable denominator, fiber/diet plan, and documented or clinician-guided rationale. Do not exceed 2.0.
  frequency:
    sessionsPerWeek: 7
    sessionsPerDay: 1
  interventionSessionsMinimum: 42
  interventionSessionsTarget: 56
  steps:
    - "Pick denominator first: actual, adjusted, goal, or clinician-specified body weight; record which value you used."
    - "Use adjusted/goal/clinician weight when actual body weight creates an unrealistic target."
    - "Choose 1.5–1.6 g/kg/day by default; reserve 1.8–2.0 for negative safety screen and documented rationale."
    - "Calculate daily grams: chosen body weight in kg × selected g/kg/day target."
    - "Baseline 7–14 days: log usual protein, weight, satiety, GI comfort, fiber, training, and goal."
    - "Build a food-first meal plan; use powders, bars, or shakes only to fill logged gaps, never above 2.0 g/kg/day."
    - "Log protein grams, g/kg, energy if available, fiber, saturated fat, source mix, satiety, GI comfort, and training changes."
    - "Review first 2 weeks; lower or pause if target crowds out fiber, worsens GI symptoms, or feels unsustainable."
  tips:
  - Choose denominator first: actual, adjusted, goal, or clinician-specified body weight; then calculate grams.
  - Start at 1.5–1.6 g/kg/day unless you have a clear reason for 1.8–2.0.
  - Build meals around eggs, Greek yogurt, fish, poultry, tofu, tempeh, beans, lentils, lean meat, and protein powder only for gaps.
  - Keep fiber visible: legumes, whole grains, vegetables, fruit, seeds, and fluids in the daily plan.
  - Do not stack new training, calorie deficit, creatine, meal replacements, keto, or supplement-heavy shakes unless declared.
  - Do not treat assigned target as exposure; log actual grams, g/kg, fiber, source mix, and GI comfort.
  keepInMind:
  - This protocol tests achieved daily protein intake; an assigned target that is not reached is not the same exposure.
  - The best-supported body-composition signals come mainly from energy-restriction or adjacent training contexts, so weight-stable users should keep expectations conservative.
  - The upper end of the band is not proven better for everyone. More protein can increase cost, planning burden, GI load, saturated-fat drift, or kidney/gout/stone relevance in susceptible users.
  - Wearables are context for sleep, activity, and recovery, not primary evidence that High Protein Intake worked.
  logFields:
  - body_weight_denominator
  - target_protein_g_per_kg
  - target_protein_g_per_day
  - daily_protein_grams
  - daily_protein_g_per_kg
  - tracking_method
  - energy_intake_kcal_if_logged
  - fiber_g_day
  - saturated_fat_g_day
  - protein_source_mix
  - supplement_use
  - satiety_or_hunger_rating
  - digestive_comfort
  - bowel_changes
  - body_weight
  - waist_or_body_composition_if_measured
  - training_context
  - sleep_or_activity_context
  - symptoms_or_adverse_events
  sessionFieldIds:
  - daily_protein_grams
  - daily_protein_g_per_kg
  - target_met
  - energy_intake_kcal
  - fiber_g_day
  - saturated_fat_g_day
  - protein_source_mix
  - supplement_use
  - satiety_rating
  - digestive_comfort
  - body_weight
  - training_context
  - symptoms_or_adverse_events
  - fluid_or_hydration_context
  - sodium_or_salty_processed_food_context
  - calcium_or_dairy_context
  - purine_heavy_foods
  - nondairy_animal_protein_servings
  - red_or_processed_meat_servings
  - seafood_or_shellfish_servings
  - plant_soy_legume_dairy_meat_seafood_supplement_split
  - supplement_product_and_dose
  - constipation_diarrhea_reflux_bloating_nausea
  - blood_pressure_if_tracked
  - relevant_lab_changes_or_new_clinician_advice
  stopConditions:
  - Stop or pause the experiment and seek clinician guidance if new or worsening flank pain, blood in urine, painful urination, marked urinary changes, fever with urinary symptoms, sudden hot/swollen painful joint, gout flare symptoms, severe or persistent constipation, diarrhea, nausea/vomiting, reflux, bloating, abdominal pain, dehydration, unusual weakness, or concerning lab changes occur.
  - Pause and redesign the plan if hitting the target requires crowding out fiber-rich plants, legumes, whole grains, vegetables, or fruit; creates persistent constipation or GI distress; or shifts the diet into a low-fiber/very-low-carbohydrate pattern.
  - Stop the base protocol if the user starts stacking protein supplements, exceeds 2.0 g/kg/day, or turns the run into an athlete-cutting, bodybuilding, supplement-heavy, ketogenic, or disease-treatment protocol.
  - Do not continue unsupervised if new information reveals CKD, reduced eGFR, albuminuria/proteinuria, diabetes with kidney risk or uncertain kidney status, renal hyperfiltration, mild renal insufficiency, recurrent kidney stones, gout/hyperuricemia requiring medical management, abnormal liver tests, a clinician-prescribed diabetes/lipid/CVD/kidney/bariatric diet, recent bariatric surgery, frailty/malnutrition/post-hospital recovery, possible pregnancy, lactation/postpartum nutrition, under-18 status, or significant liver disease.
  - Pause for clinician review if follow-up labs show new reduced eGFR, rising creatinine/BUN/urea outside the user’s expected context, new or worsening albuminuria/proteinuria, clinically concerning uric acid, LDL-C/triglyceride worsening after source-mix changes, or abnormal liver enzymes/bilirubin.
  - Pause if the plan causes restrictive eating patterns, distress around food, or a meaningful return of disordered-eating behaviors.
testPlans:
-
  planId: protein-floor-70d-basic
  durationDays: 70
  baselineDays: 14
  interventionDays: 56
  primaryBiomarkerKey: biomarker:body-weight
  secondaryBiomarkerKeys:
  - biomarker:body-fat-percent
  - biomarker:lean-mass
  - biomarker:subjective-satiety
  - biomarker:triglycerides
  - biomarker:ldl-c
  - biomarker:blood-pressure
  - biomarker:digestive-comfort
  - biomarker:serum-creatinine
  - biomarker:estimated-gfr
  safetyOutcomeKeys:
  - biomarker:serum-creatinine
  - biomarker:estimated-gfr
  - biomarker:blood-urea-nitrogen
  - biomarker:serum-uric-acid
  - biomarker:ldl-c
  - biomarker:triglycerides
  - biomarker:urine-albumin-creatinine-ratio
  - biomarker:blood-pressure
  - biomarker:alanine-aminotransferase
  - biomarker:aspartate-aminotransferase
  - biomarker:bilirubin
  minimumAdherenceSessions: 42
  targetAdherenceSessions: 56
  notes:
  - Daily protein g/kg, total protein grams, energy intake, fiber, saturated fat, and source mix are exposure or interpretation context, not outcome wins.
  - Weight, body-composition, appetite, blood-pressure, and lipid outcomes must be interpreted by energy balance, training context, medication changes, and source mix.
  - Kidney and liver safety labs are optional for low-risk users but important when kidney, gout, stone, metabolic, lipid, age, diabetes-related renal-risk, or clinician context makes them relevant.
expectedSignalDescriptions:
-
  biomarkerKey: biomarker:body-weight
  expected: Goal-dependent
  description: "Protein-rich meals slow digestion, increase satiety signaling, and cost more energy to process, helping a calorie deficit hold when energy intake drops."
  estimatedChange:
    kind: mixed_or_contextual
    window: 8 weeks
    confidence: low
    basis: Direction depends on energy balance and training; direct and adjacent trials support small weight-loss or regain-control advantages mainly in hypocaloric or post-weight-loss settings.
  protocolProminence: focus
-
  biomarkerKey: biomarker:body-fat-percent
  expected: Could trend lower
  expectedDirection: down
  description: "Amino acids support lean tissue during a deficit, shifting more weight loss toward fat instead of muscle."
  estimatedChange:
    kind: absolute
    low: -2.0
    high: -0.5
    unit: "%"
    window: 8-12 weeks
    confidence: low
    basis: Direct 1.6 g/kg/day weight-loss trials show better fat-loss partitioning, but estimates shrink in weight-stable runs and home body-composition tools are noisy.
  protocolProminence: focus
-
  biomarkerKey: biomarker:lean-mass
  expected: Hold steadier
  expectedDirection: up_or_stable
  description: "Extra amino acids supply muscle repair and protein turnover, helping lean tissue stay steadier during dieting or training."
  estimatedChange:
    kind: absolute
    low: 0.0
    high: 0.8
    unit: kg
    window: 8-12 weeks
    confidence: low
    basis: Above-RDA protein meta-analyses show about 0.3 kg overall lean-mass advantage and roughly 0.8 kg with resistance training; diet-only target-dose trials are mixed.
  protocolProminence: focus
-
  biomarkerKey: biomarker:subjective-satiety
  expected: Could feel fuller
  expectedDirection: up
  description: "Protein slows gastric emptying and activates gut satiety signals, reducing hunger after meals."
  estimatedChange:
    kind: absolute
    low: 0.5
    high: 1.5
    unit: 1-10 score points
    window: days to 2 weeks
    confidence: low
    basis: Acute protein studies show higher fullness and lower hunger, while longer diet trials do not consistently separate protein dose, source, calories, and weight change.
  protocolProminence: focus
-
  biomarkerKey: biomarker:triglycerides
  expected: Could trend lower
  expectedDirection: down
  description: "Replacing refined carbohydrates with lean protein and losing body fat reduces liver export of triglyceride-rich VLDL."
  estimatedChange:
    kind: absolute
    low: -20
    high: -5
    unit: mg/dL
    window: 8-16 weeks
    confidence: low
    basis: Direct 1.6 g/kg/day and broader higher-protein weight-loss evidence show triglyceride improvements, but protein-only attribution is weak because carbohydrate intake and weight often change too.
  protocolProminence: context
-
  biomarkerKey: biomarker:ldl-c
  expected: Source-dependent
  expectedDirection: mixed_or_contextual
  description: "LDL follows source mix: lean or plant proteins lower saturated-fat load, while fatty meats and dairy raise it."
  estimatedChange:
    kind: absolute
    low: -5
    high: 10
    unit: mg/dL
    window: 8-16 weeks
    confidence: mixed
    basis: Direct target-dose and metabolic trials show mixed LDL-C effects, including cases where the lower-protein comparator looked better; saturated-fat drift drives the range.
  protocolProminence: context
-
  biomarkerKey: biomarker:blood-pressure
  expected: Could dip slightly
  expectedDirection: down_or_stable
  description: "Weight loss, better carbohydrate quality, and lower vascular load reduce pressure; extra sodium or processed meats push the other way."
  estimatedChange:
    kind: absolute
    low: -4
    high: 0
    unit: mmHg
    window: 8-16 weeks
    confidence: low
    basis: Higher-protein diet meta-analyses and short energy-restricted trials show small systolic or diastolic improvements, but protein is bundled with weight and carbohydrate changes.
  protocolProminence: context
-
  biomarkerKey: biomarker:digestive-comfort
  expected: Watch GI comfort
  description: "Large protein portions, new sources, and lost fiber change gut load, causing constipation, reflux, bloating, or diarrhea."
  estimatedChange:
    kind: mixed_or_contextual
    window: days to 2 weeks
    confidence: low
    basis: Target-range food-based trials were generally tolerable, while low-carb or low-fiber high-protein patterns shifted gut metabolites; symptom direction depends on source and fiber.
  protocolProminence: context
-
  biomarkerKey: biomarker:serum-creatinine
  expected: Should stay stable
  expectedDirection: up_or_stable
  description: "More protein, meat, creatine, training, and lean mass change creatinine context by increasing renal workload and muscle-derived byproducts."
  estimatedChange:
    kind: absolute
    low: 0.0
    high: 0.1
    unit: mg/dL
    window: 8-12 weeks
    confidence: low
    basis: Healthy-adult high-protein trials and reviews usually show stable creatinine over short windows, with small renal-workload shifts and limited long-term certainty.
  protocolProminence: context
-
  biomarkerKey: biomarker:estimated-gfr
  expected: Should stay stable
  expectedDirection: mixed_or_contextual
  description: "Protein increases renal blood-flow demand, shifting eGFR through hydration, creatinine production, and lab-equation inputs."
  estimatedChange:
    kind: absolute
    low: -5
    high: 5
    unit: mL/min/1.73 m2
    window: 8-12 weeks
    confidence: low
    basis: Healthy-adult evidence generally does not show adverse short-term GFR change, but trials use surrogate renal markers and exclude kidney-risk groups.
  protocolProminence: context
experimentOnboarding:
  schemaVersion: "murph.commons.experiment-onboarding.v2"
  startIntent:
    displayPrompt: "Hey Murph, I want to explore doing High Protein Intake."
    intentSummary: "Explore High Protein Intake"
  safetyScreen:
    dispositionIfAnyPositive: "clinician_guidance_before_unsupervised_start"
    mustAsk:
      - id: "kidney_or_protein_restriction"
        prompt: "known kidney disease, reduced eGFR, renal hyperfiltration, mild renal insufficiency, abnormal creatinine or kidney labs, albuminuria or proteinuria, diabetes with kidney risk or uncertain kidney status, dialysis, kidney transplant history, or a clinician-directed protein restriction"
      - id: "stones_gout_or_urate"
        prompt: "recurrent kidney stones, uric-acid or cystine stones, high urine uric acid, low urine citrate, gout, marked hyperuricemia, urate-lowering medication context, or a plan that relies heavily on nondairy animal protein, red/processed meat, poultry, fish/shellfish, or other purine-heavy sources"
      - id: "pregnancy_liver_or_digestive"
        prompt: "pregnancy or possible pregnancy, trying to conceive, lactation or postpartum nutrition, significant liver disease or cirrhosis, abnormal liver tests, or severe digestive intolerance that could worsen with a higher-protein or lower-fiber diet"
      - id: "eating_disorder_or_restriction_risk"
        prompt: "active eating disorder, past disordered eating that could be reactivated by macro tracking, or distress around strict food rules"
      - id: "clinical_nutrition_context"
        prompt: "recent bariatric surgery, post-hospital recovery, frailty, malnutrition, sarcopenia treatment, nursing-home or institutional nutrition, under-18 status, or another clinician-supervised nutrition plan"
        ifPositive: "clinician_guidance_before_unsupervised_start"
      - id: "cardiometabolic_or_prescribed_diet_context"
        prompt: "established cardiovascular disease, major dyslipidemia, diabetes/prediabetes, metabolic syndrome, or a clinician-prescribed diabetes, lipid, cardiovascular, kidney, bariatric, or weight-loss diet"
        ifPositive: "clinician_guidance_before_unsupervised_start"
  setupSlots:
    - id: "body_weight_kg"
      label: "Body-weight denominator value"
      question: "What body-weight value should the protein target use, in kilograms?"
      target:
        object: "experimentRun"
        field: "bodyWeightKg"
    - id: "dose_denominator"
      label: "Dose denominator"
      question: "Should the g/kg target use actual body weight, adjusted body weight, goal body weight, or a clinician-specified denominator?"
      options:
        - "actual_body_weight"
        - "adjusted_body_weight"
        - "goal_body_weight"
        - "clinician_specified_weight"
      target:
        object: "experimentRun"
        field: "doseDenominator"
    - id: "target_g_per_kg"
      label: "Target g/kg/day"
      question: "Which target should this run use: 1.5, 1.6, 1.8, or 2.0 g/kg/day? Default to 1.5–1.6; 1.8–2.0 requires a negative safety screen, preserved fiber/diet quality, and documented rationale."
      options:
        - "target_1_5"
        - "target_1_6"
        - "target_1_8"
        - "target_2_0"
      constraints:
        allowedRangeGPerKg:
          - 1.5
          - 2
        higherTargetRequires:
          - "negative_safety_screen"
          - "appropriate_denominator"
          - "fiber_and_diet_quality_preserved"
          - "documented_or_clinician_guided_rationale"
        doNotExceedGPerKg: 2
      target:
        object: "experimentRun"
        field: "targetGPerKg"
    - id: "baseline_protein_known"
      label: "Baseline protein known"
      question: "Do you already know your usual daily protein intake from recent logs?"
      target:
        object: "onboardingCapture"
        field: "baselineProteinKnown"
    - id: "tracking_method"
      label: "Tracking method"
      question: "How will you track protein: nutrition app, photo plus estimate, meal template, dietitian plan, or another method?"
      options:
        - "nutrition_app"
        - "photo_plus_estimate"
        - "meal_template"
        - "dietitian_plan"
        - "other_method"
      target:
        object: "experimentRun"
        field: "trackingMethod"
    - id: "energy_balance_goal"
      label: "Energy-balance goal"
      question: "Is this run meant to be weight loss, weight maintenance, muscle gain, or only a protein-target adherence test?"
      options:
        - "weight_loss"
        - "weight_maintenance"
        - "muscle_gain"
        - "adherence_only"
        - "unsure"
      target:
        object: "experimentRun"
        field: "energyBalanceGoal"
    - id: "primary_outcome"
      label: "Primary outcome"
      question: "What should be the main read: adherence, satiety, weight trend, body composition, digestive comfort, training support, or lab context?"
      options:
        - "adherence"
        - "satiety"
        - "weight_trend"
        - "body_composition"
        - "digestive_comfort"
        - "training_support"
        - "lab_context"
      target:
        object: "analysisPlan"
        field: "primaryOutcome"
    - id: "protein_source_plan"
      label: "Protein source plan"
      question: "What foods or supplements will you mainly use to hit the target, and how will you avoid supplement stacking, high saturated-fat drift, red/processed-meat drift, seafood/shellfish overreliance, or purine-heavy source shifts?"
      target:
        object: "experimentRun"
        field: "proteinSourcePlan"
    - id: "fiber_guardrail"
      label: "Fiber guardrail"
      question: "Can you keep fiber-rich plants, legumes, whole grains, vegetables, and fruit in the plan rather than replacing them with protein-only foods?"
      constraints:
        ifFalse: "redesign_lower_target_or_pause"
      target:
        object: "onboardingCapture"
        field: "fiberGuardrail"
    - id: "reminder_policy"
      label: "Reminder policy"
      question: "Want daily logging reminders, a weekly check-in, both, or none?"
      options:
        - "none"
        - "daily_log"
        - "weekly_digest"
        - "daily_log_plus_weekly_digest"
      constraints:
        askWhen: "at_confirmation"
      target:
        object: "assistantSupport"
        field: "reminderPolicy"
  planDefaults:
    testPlanId: "protein-floor-70d-basic"
    firstSessionGuidance: "Start at the lower end of the selected band and verify GI comfort, fiber, hydration, and practicality before pushing higher."
  trackingHints:
    confounderFields:
      - "calorie_deficit_or_surplus"
      - "carbohydrate_displacement"
      - "new_training_program"
      - "travel_or_eating_out"
      - "illness"
      - "alcohol"
      - "menstrual_cycle_context"
      - "new_medication_or_supplement"
      - "sleep_disruption"
      - "baseline_protein_intake"
      - "baseline_fiber_intake"
      - "diabetes_prediabetes_or_metabolic_syndrome_context"
      - "kidney_liver_gout_stone_lipid_or_cardiovascular_history"
      - "clinician_prescribed_diet_or_medication_change"
      - "hydration_or_heat_exposure"
      - "sodium_intake_shift"
      - "calcium_or_dairy_shift"
      - "purine_or_nondairy_animal_protein_shift"
      - "red_or_processed_meat_shift"
      - "supplement_stacking_or_product_change"
      - "bariatric_frailty_malnutrition_or_post_hospital_context"
    notes:
      - "Daily check-ins should be neutral records of what happened, not compliance judgments."
  supportHints:
    missedLogFollowupCopy: "Did you get a protein log for today? Totally fine either way — I just want the experiment record to reflect what happened."
whyItWorks:
  - "## Amino acids set repair floor\n\nProtein supplies essential amino acids, especially leucine, for muscle protein synthesis. A daily floor prevents low-intake days from starving repair."
  - "## Protein slows the meal\n\nHigher-protein meals empty more slowly and trigger stronger satiety signals. Hunger drops when protein replaces lower-satiety calories instead of just adding more food."
  - "## Training decides muscle signal\n\nProtein supports adaptation; resistance training creates the strongest demand. Lean-mass changes come from amino acids plus load, not protein alone."
mechanismChain:
  -
    label: "Daily dose"
    content: "Protein floor · real food · spread across meals"
  -
    label: "Acute effect"
    content: "Essential amino acids reach muscle; satiety signals rise"
  -
    label: "Repeated signal"
    content: "Muscle protein synthesis pulses · slower digestion · fewer low-protein days"
  -
    label: "Adaptation"
    content: "Lean mass holds · hunger drops · training recovery gets substrate"
claims:
-
  claimId: protein-floor-target-boundary
  type: design_guardrail
  text: Define the base intervention as a whole-diet daily protein floor in the 1.5–2.0 g/kg/day neighborhood; the closest direct anchors are mostly near 1.5–1.6 g/kg/day, so lower-dose, percent-energy, shake-only, meal-replacement, or timing-only records should be downgraded unless achieved total daily g/kg/day intake is documented.
  strength: moderate
  sourceKeys:
  - source_artifact:pmid-18990242
  - source_artifact:pmid-19158228
  - source_artifact:pmid-22691622
  - source_artifact:pmid-23739654
  - source_artifact:pmid-33975325
  - source_artifact:pmid-28601864
  caveats:
  - Several direct or near-direct trials bundled protein changes with carbohydrate or energy-balance changes.
  - A 1.34 g/kg/day shake-assisted metabolic-syndrome study is below the nominal floor and should be treated as near-direct rather than exact.
-
  claimId: one-point-six-g-kg-direct-anchor
  type: intervention_result
  text: The strongest direct target-dose anchor is approximately 1.6 g/kg/day compared with 0.8 g/kg/day during energy restriction; extracted RCT findings support fat-mass or body-fat partitioning and selected lipid or adherence signals more consistently than guaranteed extra scale-weight loss.
  strength: moderate
  sourceKeys:
  - source_artifact:pmid-18990242
  - source_artifact:pmid-19158228
  - source_artifact:pmid-22691622
  - source_artifact:pmid-23739654
  caveats:
  - Most direct positive sources are energy-restriction or weight-loss contexts, not neutral-energy self-experiments.
  - Several arms changed carbohydrate or diet pattern along with protein, so protein is not always isolated.
-
  claimId: direct-evidence-mixed-endpoints
  type: mixed_evidence
  text: 'Direct target-dose evidence plus adjacent boundary trials support cautious body-composition framing more than guaranteed scale-weight superiority: some direct arms improved body-fat or fat-free-mass partitioning and selected cardiometabolic markers, while direct null and adjacent boundary trials did not confirm fat-free-mass, resting-energy-expenditure, function, or long-term scale-weight superiority.'
  strength: moderate
  sourceKeys:
  - source_artifact:pmid-18990242
  - source_artifact:pmid-19158228
  - source_artifact:pmid-22691622
  - source_artifact:pmid-23739654
  - source_artifact:pmid-33975325
  - source_artifact:pmid-19246357
  caveats:
  - Do not phrase the protocol as a guaranteed weight-loss diet.
  - The cleanest favorable signals are often body-composition partitioning or selected lab markers rather than simple mean scale-weight loss.
-
  claimId: achieved-dose-and-denominator-required
  type: design_guardrail
  text: The protocol should require achieved protein intake in g/kg/day and a declared body-weight denominator, not just an assigned target, because extracted sources report under-achievement, diet-separation drift, and different denominator methods such as actual, adjusted, ideal, or goal body weight.
  strength: moderate
  sourceKeys:
  - source_artifact:pmid-22691622
  - source_artifact:pmid-19246357
  - source_artifact:pmid-28340516
  - source_artifact:pmid-34141717
  - source_artifact:pmid-27677487
  - source_artifact:pmid-33444206
  - source_artifact:pmid-36678203
  - source_artifact:pmid-37960220
  caveats:
  - The POUNDS Lost protein-marker finding is association and measurement context, not proof that protein prescription caused weight loss.
  - Denominator sources are often clinical, older-adult, or below-floor contexts, so they support setup clarity rather than efficacy.
-
  claimId: higher-than-one-point-six-not-proven-better
  type: mixed_evidence
  text: The corpus supports increasing protein above RDA-like lower targets in some contexts, but it does not establish that escalating above about 1.6 g/kg/day improves core outcomes for ordinary users; higher-intake adjacent contexts show ceiling, null, or context-specific effects.
  strength: moderate
  sourceKeys:
  - source_artifact:pmid-23739654
  - source_artifact:pmid-28385919
  - source_artifact:pmid-24834017
  - source_artifact:healthcouncil-netherlands-protein-older-adults-2021-03-02
  - source_artifact:pmid-37516903
  caveats:
  - The ceiling or null sources are adjacent populations or settings.
  - This does not prove that 2.0 g/kg/day is never useful; it means the extraction did not support a blanket advantage over a lower high-protein target.
-
  claimId: energy-balance-must-be-classified
  type: design_guardrail
  text: Protocol claims about weight, satiety, energy expenditure, or body composition should be tagged by energy-balance context because hypocaloric, eucaloric, ad libitum, hypercaloric, maintenance-after-weight-loss, ketogenic, and meal-replacement settings answer different questions.
  strength: high
  sourceKeys:
  - source_artifact:pmid-15941879
  - source_artifact:pmid-18990242
  - source_artifact:pmid-19158228
  - source_artifact:pmid-19246357
  - source_artifact:pmid-21105792
  - source_artifact:pmid-18175736
  - source_artifact:pmid-16434457
  - source_artifact:pmid-16735482
  - source_artifact:doi-10.1007-s00394-021-02747-1
  caveats:
  - Energy restriction, carbohydrate displacement, formula feeding, and ketosis can dominate outcomes.
  - The Murph run should record weight-loss intent and energy-intake context instead of treating all high-protein diets as equivalent.
-
  claimId: satiety-short-term-plausible-long-term-mixed
  type: mixed_evidence
  text: 'Satiety, hunger, fullness, and spontaneous energy intake are plausible short-term outcomes: acute preload and short controlled-diet studies often show greater fullness or lower intake, but longer-term appetite effects and real-world energy-intake changes remain uncertain.'
  strength: low
  sourceKeys:
  - source_artifact:pmid-26947338
  - source_artifact:pmid-32768415
  - source_artifact:pmid-16434457
  - source_artifact:pmid-16735482
  - source_artifact:pmid-23221572
  - source_artifact:pmid-24760974
  - source_artifact:doi-10.1007-s00394-021-02747-1
  - source_artifact:pmid-29431471
  caveats:
  - Acute preload findings do not establish long-term weight outcomes.
  - Extreme contexts such as high-altitude severe energy deficit should not be generalized to ordinary users.
-
  claimId: training-context-changes-interpretation
  type: design_guardrail
  text: Each run should be classified as no-training, stable-training, resistance-training cointervention, athlete or energy-deficit training, or recovery-focused because lean-mass, strength, performance, and recovery evidence changes meaning across those contexts.
  strength: moderate
  sourceKeys:
  - source_artifact:pmid-31794597
  - source_artifact:pmid-33975325
  - source_artifact:pmid-24834017
  - source_artifact:pmid-28698222
  - source_artifact:pmid-29182451
  - source_artifact:pmid-32698121
  - source_artifact:pmid-40292443
  caveats:
  - This is a synthesis guardrail, not a single-trial result.
  - Athlete, resistance-training, recovery, and very-high-dose studies are mostly adjacent or same-mechanism evidence rather than direct protocol proof.
-
  claimId: meal-distribution-optional-not-mandatory
  type: mixed_evidence
  text: 'Meeting the total daily protein target should come before optimizing meal pattern: protein distribution, protein pacing, breakfast protein, and workout timing are optional implementation layers, and outcome evidence does not support making even distribution mandatory.'
  strength: moderate
  sourceKeys:
  - source_artifact:pmid-24299050
  - source_artifact:pmid-29497353
  - source_artifact:pmid-28919842
  - source_artifact:pmid-32232404
  - source_artifact:pmid-38986499
  - source_artifact:pmid-28318687
  - source_artifact:pmid-28903957
  - source_artifact:pmid-36364705
  - source_artifact:pmid-37086618
  - source_artifact:pmid-38365118
  - source_artifact:doi-10.1016-j.nutos.2025.05.008
  - source_artifact:pmid-32429355
  caveats:
  - Distribution sources are timing, physiology, guideline, review, commentary, older-adult, or resistance-training context rather than direct Murph protein-floor trials.
  - Null or mixed evidence does not mean distribution is useless for every person; it means the base protocol should not require it.
-
  claimId: source-flexible-but-source-quality-matters
  type: mixed_evidence
  text: The extraction does not show a consistent animal-versus-plant winner when total protein is matched or broadly comparable, but source quality still matters because saturated fat, fiber displacement, lipid markers, processing, cost, and GI tolerance can change the risk-benefit profile.
  strength: moderate
  sourceKeys:
  - source_artifact:pmid-36822394
  - source_artifact:pmid-24944057
  - source_artifact:pmid-26821042
  - source_artifact:pmid-30151230
  - source_artifact:pmid-39486625
  - source_artifact:pmid-31161217
  - source_artifact:pmid-22170364
  - source_artifact:pmid-11591629
  - source_artifact:pmid-34724806
  - source_artifact:usda-hhs-dietary-guidelines-2026-01-07
  - source_artifact:pmid-31547446
  - source_artifact:pmid-41260173
  caveats:
  - Comparable muscle or weight outcomes do not mean all sources have equal lipid, gut, cost, sodium, processing, or environmental profiles.
  - Lipid-marker findings are not direct long-term CVD outcome evidence for the protocol.
-
  claimId: fiber-displacement-gut-guardrail
  type: safety
  text: The protocol should protect fiber and plant-food intake while increasing protein because high-protein low-carbohydrate or low-fiber patterns showed adverse fecal metabolite and butyrate-related signals, whereas food-based target-range protein evidence is shorter and has metabolite or fiber-data gaps.
  strength: moderate
  sourceKeys:
  - source_artifact:pmid-21389180
  - source_artifact:pmid-41640738
  - source_artifact:pmid-30274898
  - source_artifact:pmid-31174214
  - source_artifact:usda-hhs-dietary-guidelines-2026-01-07
  - source_artifact:pmid-22510792
  - source_artifact:pmid-32199523
  caveats:
  - Phrase this as a fiber-displacement and whole-diet guardrail, not as proof that protein alone causes gut harm.
  - Microbiota composition endpoints do not fully capture functional metabolites such as TMAO or proteolytic fermentation products.
-
  claimId: ckd-or-abnormal-kidney-context-needs-clinician-guidance
  type: safety
  text: People with known chronic or acute kidney disease, abnormal kidney function or albuminuria, diabetes or prediabetes with unknown or abnormal kidney status, renal hyperfiltration or mild renal insufficiency, or clinician-directed protein restriction should not self-apply a 1.5–2.0 g/kg/day protein floor; these are individualized clinical nutrition contexts.
  strength: high
  sourceKeys:
  - source_artifact:pmid-38490803
  - source_artifact:pmid-32829751
  - source_artifact:pmid-33640205
  - source_artifact:pmid-16174292
  - source_artifact:doi-10.1017-s0029665112000122
  - source_artifact:pmid-12639078
  - source_artifact:pmid-31172186
  - source_artifact:pmid-32669325
  caveats:
  - These sources define kidney-disease safety boundaries; they are not direct efficacy evidence for healthy adults using the protein-floor protocol.
-
  claimId: healthy-adult-renal-marker-evidence-not-lifetime-clearance
  type: mixed_evidence
  text: In adults without CKD, short- and medium-term renal-marker evidence is not a clean harm signal, but it is also not a lifetime safety guarantee; higher-protein diets can raise or change renal workload markers such as GFR/eGFR, urea, urinary calcium, uric acid, and renal hemodynamics.
  strength: moderate
  sourceKeys:
  - source_artifact:pmid-30383278
  - source_artifact:pmid-30032227
  - source_artifact:pmid-24852037
  - source_artifact:pmid-23219108
  - source_artifact:pmid-19812175
  - source_artifact:pmid-38490803
  - source_artifact:pmid-32829751
  caveats:
  - Most evidence uses surrogate kidney markers, heterogeneous diet definitions, and limited follow-up.
  - Do not phrase higher eGFR or GFR as either benefit or harm without clinical context.
-
  claimId: stones-gout-pregnancy-liver-route-to-guidance
  type: safety
  text: Kidney-stone history, gout or marked hyperuricemia, pregnancy or possible pregnancy, abnormal liver tests, and significant liver disease should be routed to clinician-guided nutrition rather than an unsupervised source-agnostic protein floor.
  strength: high
  sourceKeys:
  - source_artifact:pmid-24857648
  - source_artifact:eau-urolithiasis-guidelines-2026-04-26
  - source_artifact:pmid-35179185
  - source_artifact:pmid-37133532
  - source_artifact:pmid-11784873
  - source_artifact:pmid-32391934
  - source_artifact:nice-gout-ng219-2022-06-09
  - source_artifact:pmid-27457514
  - source_artifact:who-high-protein-pregnancy-2023-08-09
  - source_artifact:pmid-26031211
  - source_artifact:pmid-14583907
  - source_artifact:pmid-33572843
  - source_artifact:pmid-30144956
  - source_artifact:pmid-30712783
  - source_artifact:pmid-33096810
  - source_artifact:pmid-41638233
  caveats:
  - Stone-prevention diets often change sodium, calcium, fluids, and protein together, so protein isolation is limited.
  - Pregnancy supplementation evidence is not the same as food-based protein intake in nonpregnant adults, and balanced energy-protein supplementation is a distinct intervention.
-
  claimId: wearables-are-context-not-primary-outcomes
  type: evidence_scope
  text: 'Wearables should be treated as context rather than primary biomarkers for this protocol: sleep and activity data can explain adherence, appetite, and recovery patterns, but the extraction set does not support claims that High Protein Intake improves HRV, resting heart rate, VO2max, or sleep as primary outcomes.'
  strength: low
  sourceKeys:
  - source_artifact:pmid-26864362
  - source_artifact:pmid-34959931
  - source_artifact:pmid-16046715
  - source_artifact:pmid-34141717
  - source_artifact:pmid-33026154
  caveats:
  - Sleep evidence is adjacent and energy-restriction-specific, not a direct wearable sleep protocol result.
  - Activity and exercise often co-intervene with protein and can create false attribution if not logged.
researchLandscape:
  bottomLine: 'Best read as a bounded nutrition self-experiment: hit and verify a declared 1.5–2.0 g/kg/day protein floor, then interpret body composition, appetite, weight, labs, and tolerability through energy balance, training context, source quality, and safety boundaries.'
  confidenceLabel: mixed
  primaryClaim: For appropriate adults, the most defensible evidence-based reason to test High Protein Intake is body-composition partitioning, satiety or meal-structure support, and adherence learning—not guaranteed weight loss, lean-mass gain, or cardiometabolic improvement.
  mainCaveat: The strongest direct anchors are mostly hypocaloric, overweight/obesity, or controlled contexts near 1.5–1.6 g/kg/day, while many other sources are adjacent variants, mechanisms, safety boundaries, or external guidelines.
  groups:

  -
    id: direct-target-dose-evidence
    label: Direct, near-direct, and adjacent target-dose boundary evidence
    stance: mixed
    summary: This group combines clean direct 1.5–1.6 g/kg/day anchors with lower-dose, percent-protein, maintenance, and historical higher-protein boundary records. Use it for cautious body-composition and selected metabolic framing while keeping adjacent records visibly downgraded and preserving null or mixed endpoint findings.
    sourceKeys:
    - source_artifact:pmid-18990242
    - source_artifact:pmid-19158228
    - source_artifact:pmid-22691622
    - source_artifact:pmid-23739654
    - source_artifact:pmid-19246357
    - source_artifact:pmid-21105792
    - source_artifact:pmid-33975325
    - source_artifact:pmid-15941879
    - source_artifact:pmid-28601864
    - source_artifact:pmid-12566476
    - source_artifact:pmid-12816768
    defaultOpen: true
  -
    id: systematic-review-dose-response-anchors
    label: Dose-response and synthesis anchors
    stance: mixed
    summary: Reviews and dose-response syntheses help bound the 1.5–2.0 g/kg/day target, but they mix training, aging, energy deficit, and non-whole-diet contexts.
    sourceKeys:
    - source_artifact:pmid-39002131
    - source_artifact:pmid-31794597
    - source_artifact:pmid-34579069
    - source_artifact:pmid-25926512
    - source_artifact:pmid-26947338
    - source_artifact:pmid-31443231
    - source_artifact:pmid-32768415
    - source_artifact:doi-10.3389-fendo.2018.00443
    - source_artifact:pmid-19400750
    - source_artifact:pmid-25540980
    - source_artifact:pmid-29182451
    - source_artifact:pmid-18469287
    - source_artifact:pmid-27431364
    defaultOpen: false
  -
    id: energy-balance-satiety-weight
    label: Energy balance, satiety, and weight context
    stance: mixed
    summary: These sources help separate protein effects from calorie deficit, maintenance after weight loss, short-term appetite mechanisms, and low-carbohydrate or ketogenic confounding.
    sourceKeys:
    - source_artifact:pmid-14710168
    - source_artifact:pmid-15788122
    - source_artifact:pmid-23446962
    - source_artifact:pmid-28679554
    - source_artifact:pmid-17299116
    - source_artifact:pmid-22215165
    - source_artifact:pmid-22935440
    - source_artifact:pmid-28385919
    - source_artifact:pmid-33247306
    - source_artifact:doi-10.1007-s00394-021-02747-1
    - source_artifact:pmid-29066613
    - source_artifact:pmid-16434457
    - source_artifact:pmid-16735482
    - source_artifact:pmid-18175736
    - source_artifact:pmid-23221572
    - source_artifact:pmid-24760974
    - source_artifact:pmid-26864362
    - source_artifact:pmid-29431471
    defaultOpen: false
  -
    id: meal-distribution-timing-protein-pacing-adjacent-evidence
    label: Meal distribution and timing context
    stance: mixed
    summary: Meal distribution, breakfast protein, protein pacing, workout timing, and per-meal dose evidence should be optional implementation context, not a requirement for the base daily floor.
    sourceKeys:
    - source_artifact:pmid-23459753
    - source_artifact:pmid-24477298
    - source_artifact:pmid-25352437
    - source_artifact:pmid-28318687
    - source_artifact:pmid-28903957
    - source_artifact:pmid-36364705
    - source_artifact:pmid-39736329
    - source_artifact:doi-10.1016-j.nutos.2025.05.008
    - source_artifact:pmid-10357740
    - source_artifact:pmid-32321161
    - source_artifact:pmid-37086618
    - source_artifact:pmid-38365118
    - source_artifact:pmid-38846541
    - source_artifact:pmid-20847729
    - source_artifact:pmid-27187451
    - source_artifact:pmid-32429355
    - source_artifact:pmid-39587799
    - source_artifact:pmid-10867039
    - source_artifact:pmid-22992307
    - source_artifact:pmid-23067428
    - source_artifact:pmid-24257722
    - source_artifact:pmid-26581685
    - source_artifact:pmid-16469977
    - source_artifact:pmid-24833780
    - source_artifact:pmid-25738784
    - source_artifact:pmid-25923481
    - source_artifact:pmid-26742068
    - source_artifact:pmid-27258301
    - source_artifact:pmid-27483317
    - source_artifact:pmid-27511985
    - source_artifact:pmid-34993224
    - source_artifact:pmid-36575144
    - source_artifact:pmid-38118410
    - source_artifact:pmid-38135050
    - source_artifact:pmid-38806467
    defaultOpen: false
  -
    id: protein-source-supplement-delivery-source-quality
    label: Source, supplement, and diet-quality context
    stance: mixed
    summary: This group covers food-first versus supplement-assisted delivery, animal versus plant source comparisons, saturated fat, fiber displacement, meal replacement, and practicality.
    sourceKeys:
    - source_artifact:pmid-34671632
    - source_artifact:pmid-35788775
    - source_artifact:pmid-30671904
    - source_artifact:pmid-38479550
    - source_artifact:pmid-27479196
    - source_artifact:pmid-39631999
    - source_artifact:pmid-39608360
    - source_artifact:pmid-10838463
    - source_artifact:pmid-40593395
    - source_artifact:pmid-34067585
    - source_artifact:pmid-27765690
    - source_artifact:pmid-30142886
    - source_artifact:pmid-22170364
    - source_artifact:pmid-30151230
    - source_artifact:pmid-24944057
    - source_artifact:pmid-29071106
    - source_artifact:pmid-39486625
    - source_artifact:pmid-18237574
    - source_artifact:doi-10.1093-ajcn-nqac152
    - source_artifact:pmid-29263032
    - source_artifact:pmid-33851213
    - source_artifact:pmid-32780794
    - source_artifact:pmid-16287956
    - source_artifact:pmid-26821042
    - source_artifact:pmid-32469398
    - source_artifact:pmid-24477043
    - source_artifact:pmid-34749132
    - source_artifact:pmid-31161217
    - source_artifact:pmid-36822394
    defaultOpen: false
  -
    id: resistance_training_athlete_body_composition_adjacent_evidence
    label: Resistance training, athlete, and body-composition adjacent evidence
    stance: context_only
    summary: Training and athlete sources are important adjacent support for protein and lean-mass interpretation, but they are not direct proof of a food-based daily floor without a training cointervention.
    sourceKeys:
    - source_artifact:pmid-28698222
    - source_artifact:pmid-33300582
    - source_artifact:pmid-19927027
    - source_artifact:pmid-26817506
    - source_artifact:pmid-35187864
    - source_artifact:pmid-36057893
    - source_artifact:doi-10.1519-ssc.0000000000000888
    - source_artifact:pmid-1400008
    - source_artifact:pmid-23097268
    - source_artifact:pmid-23134885
    - source_artifact:pmid-26500462
    - source_artifact:pmid-28166780
    - source_artifact:pmid-28895933
    - source_artifact:pmid-30475963
    - source_artifact:pmid-31021362
    - source_artifact:pmid-40011662
    - source_artifact:pmid-28662731
    - source_artifact:pmid-28814401
    - source_artifact:pmid-29405780
    - source_artifact:pmid-30475969
    - source_artifact:pmid-30848096
    - source_artifact:pmid-33599941
    - source_artifact:pmid-33842881
    - source_artifact:pmid-35390727
    - source_artifact:pmid-38746828
    - source_artifact:pmid-22889730
    - source_artifact:pmid-24092765
    - source_artifact:pmid-29200983
    - source_artifact:pmid-30909813
    - source_artifact:pmid-17413099
    - source_artifact:pmid-18500968
    - source_artifact:pmid-19056590
    - source_artifact:pmid-22406907
    - source_artifact:pmid-33550490
    - source_artifact:pmid-35990326
    - source_artifact:pmid-22150425
    - source_artifact:pmid-24299050
    - source_artifact:pmid-27054679
    - source_artifact:pmid-29497353
    - source_artifact:pmid-30507259
    defaultOpen: false
  -
    id: resistance_training_athlete_body_composition_adjacent_2
    label: Additional training and recovery adjacent evidence
    stance: context_only
    summary: Additional athlete, recovery, and training-context sources help prevent overclaiming strength, soreness, or performance improvements from protein alone.
    sourceKeys:
    - source_artifact:pmid-28790922
    - source_artifact:pmid-38986499
    - source_artifact:pmid-38219154
    - source_artifact:pmid-32698121
    - source_artifact:pmid-40292443
    - source_artifact:pmid-32867103
    - source_artifact:pmid-32232404
    - source_artifact:pmid-41754127
    defaultOpen: false
  -
    id: population-strata-baseline-requirement-methods
    label: Population strata and baseline-intake context
    stance: context_only
    summary: Population, sex, age, baseline-intake, denominator, and requirement-method sources show why user context must be logged before interpreting response.
    sourceKeys:
    - source_artifact:doi-10.1016-j.foodqual.2015.01.016
    - source_artifact:pmid-14522731
    - source_artifact:pmid-15466943
    - source_artifact:pmid-18175749
    - source_artifact:pmid-21798863
    - source_artifact:pmid-24429540
    - source_artifact:pmid-25179468
    - source_artifact:pmid-25320185
    - source_artifact:pmid-26962173
    - source_artifact:pmid-28112772
    - source_artifact:pmid-28571713
    - source_artifact:pmid-30041437
    - source_artifact:pmid-30395050
    - source_artifact:pmid-31618421
    - source_artifact:pmid-32140711
    - source_artifact:pmid-32653012
    - source_artifact:pmid-33417663
    - source_artifact:pmid-33444206
    - source_artifact:pmid-35059183
    - source_artifact:pmid-38542776
    - source_artifact:pmid-38745486
    - source_artifact:pmid-40093878
    - source_artifact:pmid-10375057
    - source_artifact:pmid-18810296
    - source_artifact:pmid-2011075
    - source_artifact:pmid-23890352
    - source_artifact:pmid-26471344
    - source_artifact:pmid-26883880
    - source_artifact:pmid-28595022
    - source_artifact:pmid-29092886
    - source_artifact:pmid-29532075
    - source_artifact:pmid-30103509
    - source_artifact:pmid-30629126
    - source_artifact:pmid-32359738
    - source_artifact:pmid-32513334
    - source_artifact:pmid-34609621
    - source_artifact:pmid-35016214
    - source_artifact:pmid-35276894
    - source_artifact:pmid-37347495
    - source_artifact:pmid-39341032
    defaultOpen: false
  -
    id: metabolic-and-cardiovascular-lab-evidence
    label: Metabolic and cardiovascular labs
    stance: mixed
    summary: Metabolic labs are endpoint-specific and source-quality-sensitive; favorable triglyceride, HDL, glucose, insulin, or HbA1c signals coexist with null, LDL, TMAO, and observational cautions.
    sourceKeys:
    - source_artifact:pmid-12566475
    - source_artifact:pmid-15007396
    - source_artifact:pmid-22104550
    - source_artifact:pmid-23587198
    - source_artifact:pmid-25332473
    - source_artifact:pmid-34120735
    - source_artifact:pmid-15480538
    - source_artifact:pmid-15800559
    - source_artifact:pmid-21524314
    - source_artifact:pmid-23829939
    - source_artifact:pmid-31338545
    - source_artifact:pmid-33026154
    - source_artifact:pmid-10497712
    - source_artifact:pmid-17622289
    - source_artifact:pmid-18175733
    - source_artifact:pmid-21246185
    - source_artifact:pmid-23592676
    - source_artifact:pmid-27187457
    - source_artifact:pmid-34345239
    - source_artifact:pmid-34959931
    - source_artifact:pmid-40360850
    - source_artifact:pmid-12915639
    - source_artifact:pmid-17536130
    - source_artifact:pmid-31145699
    - source_artifact:pmid-15331548
    - source_artifact:pmid-27159194
    - source_artifact:pmid-17341711
    defaultOpen: false
  -
    id: kidney-renal-function-ckd-boundary-evidence
    label: Kidney and renal-function safety boundaries
    stance: safety_boundary
    summary: Healthy-adult renal-marker findings are not CKD clearance. This group supports kidney-context screening, optional labs, and clinician-guided decisions for abnormal renal status.
    sourceKeys:
    - source_artifact:doi-10.1017-s0029665112000122
    - source_artifact:pmid-12639078
    - source_artifact:pmid-16174292
    - source_artifact:pmid-19812175
    - source_artifact:pmid-22510792
    - source_artifact:pmid-23219108
    - source_artifact:pmid-23908602
    - source_artifact:pmid-24852037
    - source_artifact:pmid-24967251
    - source_artifact:pmid-28637384
    - source_artifact:pmid-30383278
    - source_artifact:pmid-31172186
    - source_artifact:pmid-32669325
    - source_artifact:pmid-32829751
    - source_artifact:pmid-33640205
    - source_artifact:pmid-37457969
    - source_artifact:pmid-37516903
    - source_artifact:pmid-38490803
    - source_artifact:doi-10.1007-s12603-016-0709-y
    - source_artifact:pmid-20338292
    - source_artifact:pmid-24374004
    - source_artifact:pmid-24984995
    - source_artifact:pmid-26632754
    - source_artifact:pmid-26778925
    - source_artifact:pmid-27346534
    - source_artifact:pmid-27807480
    - source_artifact:pmid-28122929
    - source_artifact:pmid-28181738
    - source_artifact:pmid-33203389
    - source_artifact:pmid-37475689
    - source_artifact:pmid-38174000
    - source_artifact:pmid-38946781
    - source_artifact:pmid-10722779
    - source_artifact:pmid-37960220
    defaultOpen: true
  -
    id: gout-uric-acid-purine-kidney-stone-boundary-evidence
    label: Gout, uric-acid, purine, and stone-risk boundaries
    stance: safety_boundary
    summary: Stone and gout sources are source- and urine-chemistry-specific. They support screening and clinician-directed source rules rather than a source-agnostic protein increase.
    sourceKeys:
    - source_artifact:eau-urolithiasis-guidelines-2026-04-26
    - source_artifact:nice-gout-ng219-2022-06-09
    - source_artifact:pmid-24857648
    - source_artifact:pmid-32391934
    - source_artifact:pmid-11784873
    - source_artifact:pmid-21976719
    - source_artifact:pmid-30032227
    - source_artifact:pmid-35179185
    - source_artifact:pmid-37133532
    - source_artifact:pmid-15014182
    - source_artifact:pmid-22653255
    - source_artifact:pmid-25808549
    - source_artifact:pmid-33668058
    - source_artifact:pmid-11451718
    - source_artifact:pmid-15579526
    - source_artifact:pmid-15641075
    - source_artifact:pmid-18957869
    - source_artifact:pmid-8441427
    - source_artifact:pmid-24659208
    - source_artifact:pmid-27457514
    - source_artifact:pmid-8659482
    defaultOpen: false
  -
    id: digestive-microbiome-liver-pregnancy-safety-boundaries
    label: Digestive, microbiome, liver, and pregnancy boundaries
    stance: safety_boundary
    summary: This group preserves GI tolerance, fiber displacement, microbiome, pregnancy, and liver-disease safety boundaries, including mixed and negative pregnancy-supplementation signals.
    sourceKeys:
    - source_artifact:pmid-14583907
    - source_artifact:pmid-26031211
    - source_artifact:who-high-protein-pregnancy-2023-08-09
    - source_artifact:pmid-21389180
    - source_artifact:pmid-30144956
    - source_artifact:pmid-30712783
    - source_artifact:pmid-41640738
    - source_artifact:pmid-32199523
    - source_artifact:pmid-33572843
    - source_artifact:pmid-33682457
    - source_artifact:pmid-33096810
    - source_artifact:pmid-36678203
    defaultOpen: false
  -
    id: general-safety-and-adverse-event-boundary-evidence
    label: General safety and adverse-event context
    stance: safety_boundary
    summary: Short-term selected-population safety marker data can be reassuring in narrow contexts but do not establish lifetime safety or justify escalating beyond the floor.
    sourceKeys:
    - source_artifact:pmid-40541063
    - source_artifact:pmid-41260173
    - source_artifact:pmid-41638233
    - source_artifact:pmid-24284444
    - source_artifact:pmid-27732859
    - source_artifact:pmid-31547446
    - source_artifact:pmid-31867339
    - source_artifact:doi-10.1016-j.metabol.2014.02.007
    - source_artifact:pmid-24047916
    - source_artifact:pmid-24834017
    defaultOpen: false
  -
    id: implementation-adherence-burden-evidence
    label: Implementation, adherence, and burden
    stance: mixed
    summary: Adherence, appetite, cost, meal planning, GI comfort, and support needs should be measured because assigned diet and achieved intake often diverge.
    sourceKeys:
    - source_artifact:pmid-39142677
    - source_artifact:pmid-19390338
    - source_artifact:pmid-31174214
    - source_artifact:pmid-28340516
    - source_artifact:pmid-16046715
    - source_artifact:pmid-15303109
    - source_artifact:pmid-33502122
    - source_artifact:pmid-16002798
    - source_artifact:pmid-34141717
    - source_artifact:pmid-24675714
    - source_artifact:pmid-23778783
    defaultOpen: false
  -
    id: external-guideline-protocol-context
    label: External guideline and protocol context
    stance: context_only
    summary: External protocols and guidelines provide context for source quality, protein requirements, disease boundaries, and public implementation, but are not Murph protocol claims.
    sourceKeys:
    - source_artifact:pmid-11591629
    - source_artifact:pmid-17908291
    - source_artifact:pmid-24222017
    - source_artifact:pmid-26891166
    - source_artifact:pmid-28919842
    - source_artifact:pmid-30274898
    - source_artifact:pmid-34724806
    - source_artifact:doi-10.17226-10490
    - source_artifact:healthcouncil-netherlands-protein-older-adults-2021-03-02
    - source_artifact:pmid-23867520
    - source_artifact:pmid-24814383
    - source_artifact:pmid-26920240
    - source_artifact:pmid-28642676
    - source_artifact:pmid-39680699
    - source_artifact:usda-hhs-dietary-guidelines-2026-01-07
    defaultOpen: false
  -
    id: trial_registry_context
    label: Trial registry context
    stance: context_only
    summary: Trial registries identify planned or ongoing evidence seams and should not be treated as outcome evidence.
    sourceKeys:
    - source_artifact:clinicaltrials-nct03870425
    - source_artifact:clinicaltrials-nct00390637
    - source_artifact:clinicaltrials-nct01776359
    - source_artifact:clinicaltrials-nct02278757
    - source_artifact:clinicaltrials-nct02730988
    - source_artifact:clinicaltrials-nct02811276
    - source_artifact:clinicaltrials-nct03565510
    - source_artifact:clinicaltrials-nct03842579
    - source_artifact:clinicaltrials-nct00079573
    defaultOpen: false
  -
    id: other-context-records
    label: Other context records
    stance: context_only
    summary: Miscellaneous context records remain separated from direct protocol evidence.
    sourceKeys:
    - source_artifact:pmid-27677487
    defaultOpen: false
safety:
  cautionLevel: moderate
  avoidOrGetClinicianGuidance:
  - chronic_or_acute_kidney_disease
  - reduced_egfr
  - albuminuria_or_proteinuria
  - abnormal_creatinine_or_kidney_labs
  - clinician_directed_protein_restriction
  - dialysis_or_kidney_transplant
  - recurrent_kidney_stones
  - uric_acid_or_cystine_stones
  - hyperuricosuria_or_low_urine_citrate
  - gout_or_marked_hyperuricemia
  - urate_lowering_medication
  - pregnancy_or_possible_pregnancy
  - significant_liver_disease_or_cirrhosis
  - severe_digestive_intolerance
  - active_or_prior_eating_disorder
  - restrictive_eating_or_food_distress
  - diabetes_with_unknown_kidney_status
  - renal_hyperfiltration
  - clinician_prescribed_diet
  - recent_bariatric_surgery
  - frailty_or_malnutrition
  - sarcopenia_or_post_hospital_recovery
  - established_cardiovascular_disease
  - major_dyslipidemia
  - abnormal_liver_tests
  - trying_to_conceive_or_lactation
  - under_18_or_pediatric
  - target_above_2_g_per_kg_per_day
  stopIf:
  - flank_pain_blood_in_urine_or_urinary_symptoms
  - gout_flare_or_sudden_hot_swollen_joint
  - severe_or_persistent_digestive_symptoms
  - dehydration_or_unusual_weakness
  - concerning_kidney_liver_or_lipid_lab_change
  - restrictive_eating_or_disordered_eating_return
  - clinician_advises_against_or_prescribes_protein_limit
  - supplement_stacking_or_intake_above_2_g_per_kg_day
  notes:
  - Wellness experiment only — not treatment for obesity, diabetes, CKD, gout, stones, liver disease, or cardiovascular risk.
  - Safety boundaries are stricter than efficacy claims — direct evidence is mixed and population-specific.
  - Do not escalate above the selected floor to chase faster results.
  - Use 1.8–2.0 g/kg/day only with a negative screen, appropriate denominator, preserved fiber, and documented rationale — never exceed 2.0.
  - Eating-disorder, lactation/postpartum, trying-to-conceive, and under-18 contexts route to clinician guidance.
  - Supplement-heavy, ketogenic, bodybuilding/cutting, bariatric, and frailty contexts are separate variants, not this base protocol.
  - Pregnancy, lactation, or postpartum nutrition context routes to clinician guidance.
  - Do not displace fiber, plants, legumes, whole grains, or fruit to hit the target.
researchCoverage:
  bibliographyKey: source_artifact:high-protein-intake-bibliography
  corpusStats:
    canonicalLedgerRecords: 335
    sourcePagesNeeded: 334
    sourcePagesSkipped: 1
    sourceFindings: 526
    evidenceAppraisals: 334
    directProtocolLedgerRecords: 11
    supportsProtocolLedgerRecords: 9
    safetyOnlyLedgerRecords: 77
sessionLoggingFields:
- daily_protein_grams
- daily_protein_g_per_kg
- target_met
- tracking_method
- energy_intake_kcal_if_logged
- fiber_g_day
- saturated_fat_g_day
- protein_source_mix
- supplement_use
- satiety_rating
- hunger_or_cravings
- digestive_comfort
- bowel_changes
- body_weight
- waist_or_body_composition
- training_context
- sleep_or_activity_context
- symptoms_or_adverse_events
- fluid_or_hydration_context
- sodium_or_salty_processed_food_context
- calcium_or_dairy_context
- purine_heavy_foods
- nondairy_animal_protein_servings
- red_or_processed_meat_servings
- seafood_or_shellfish_servings
- plant_soy_legume_dairy_meat_seafood_supplement_split
- supplement_product_and_dose
- constipation_diarrhea_reflux_bloating_nausea
- blood_pressure_if_tracked
- relevant_lab_changes_or_new_clinician_advice
confoundersToTrack:
- calorie_deficit_or_surplus
- carbohydrate_displacement
- fat_or_saturated_fat_displacement
- fiber_displacement
- new_or_changed_training
- weight_loss_medication_or_appetite_medication
- creatine_or_new_supplement
- illness_or_infection
- travel_or_eating_out
- alcohol
- sleep_disruption
- menstrual_cycle_context
- stress
- change_in_food_logging_method
- baseline_protein_intake
- baseline_fiber_intake
- diabetes_prediabetes_or_metabolic_syndrome_context
- kidney_liver_gout_stone_lipid_or_cardiovascular_history
- clinician_prescribed_diet_or_medication_change
- hydration_or_heat_exposure
- sodium_intake_shift
- calcium_or_dairy_shift
- purine_or_nondairy_animal_protein_shift
- red_or_processed_meat_shift
- supplement_stacking_or_product_change
- bariatric_frailty_malnutrition_or_post_hospital_context
expectedSignal:
  primary:
    biomarkerKey: biomarker:body-weight
    direction: mixed
    latency: 2-8 weeks
    confidence: low
    sourceKeys:
    - source_artifact:pmid-18990242
    - source_artifact:pmid-19158228
    - source_artifact:pmid-19246357
    - source_artifact:pmid-21105792
    - source_artifact:pmid-21524314
  secondary:

  -
    biomarkerKey: biomarker:body-fat-percent
    direction: decrease_or_no_clear_change
    latency: 6-12 weeks
    confidence: low_to_moderate
    sourceKeys:
    - source_artifact:pmid-18990242
    - source_artifact:pmid-19158228
    - source_artifact:pmid-22691622
    - source_artifact:pmid-23739654
    - source_artifact:pmid-33975325
  -
    biomarkerKey: biomarker:lean-mass
    direction: stable_or_increase
    latency: 6-12 weeks
    confidence: low_to_moderate
    sourceKeys:
    - source_artifact:pmid-22691622
    - source_artifact:pmid-23739654
    - source_artifact:pmid-31794597
    - source_artifact:pmid-33300582
    - source_artifact:pmid-39002131
  -
    biomarkerKey: biomarker:subjective-satiety
    direction: improve_or_mixed
    latency: hours_to_2_weeks
    confidence: low
    sourceKeys:
    - source_artifact:pmid-26947338
    - source_artifact:pmid-32768415
    - source_artifact:pmid-16434457
    - source_artifact:pmid-16002798
  -
    biomarkerKey: biomarker:triglycerides
    direction: decrease_or_no_clear_change
    latency: 8-16 weeks
    confidence: low
    sourceKeys:
    - source_artifact:pmid-18990242
    - source_artifact:pmid-19158228
    - source_artifact:pmid-34120735
    - source_artifact:pmid-21524314
  -
    biomarkerKey: biomarker:ldl-c
    direction: mixed
    latency: 8-16 weeks
    confidence: mixed
    sourceKeys:
    - source_artifact:pmid-18990242
    - source_artifact:pmid-22104550
    - source_artifact:pmid-21524314
    - source_artifact:pmid-17536130
  -
    biomarkerKey: biomarker:blood-pressure
    direction: decrease_or_mixed
    latency: 8-16 weeks
    confidence: low
    sourceKeys:
    - source_artifact:pmid-34120735
    - source_artifact:pmid-21524314
    - source_artifact:pmid-23587198
    - source_artifact:pmid-22104550
  -
    biomarkerKey: biomarker:digestive-comfort
    direction: mixed
    latency: days_to_2_weeks
    confidence: low
    sourceKeys:
    - source_artifact:pmid-32199523
    - source_artifact:pmid-41640738
    - source_artifact:pmid-21389180
  -
    biomarkerKey: biomarker:serum-creatinine
    direction: stable_or_mild_increase
    latency: 8-12 weeks
    confidence: low
    sourceKeys:
    - source_artifact:pmid-30032227
    - source_artifact:pmid-30383278
    - source_artifact:pmid-37457969
    - source_artifact:pmid-37516903
  -
    biomarkerKey: biomarker:estimated-gfr
    direction: stable_or_mixed
    latency: 8-12 weeks
    confidence: low
    sourceKeys:
    - source_artifact:pmid-30032227
    - source_artifact:pmid-22653255
    - source_artifact:pmid-30383278
    - source_artifact:pmid-23219108
---

## Question this experiment answers

After a stable baseline, can you reliably hit a declared daily protein floor without worsening tolerability, diet quality, or safety context—and do body composition, satiety, weight trend, or optional labs move enough to make the practice worth keeping?

## Simple version

Run a 70-day experiment: 14 baseline days, then 56 intervention days. Choose a denominator, calculate the daily protein grams for a 1.5–2.0 g/kg/day target, and log whether you actually reach it. The evidence section preserves the target-dose and mixed-endpoint caveats without turning them into universal claims.

## What to watch

The main read is whether achieved daily protein changes measurable downstream signals without breaking diet quality or safety context. Start with weekly scale trend, same-method body composition, satiety, GI comfort, and optional blood pressure or lipid/kidney labs; interpret all of them through energy balance, training, source mix, fiber, and medication changes.

## What to log every day

Log daily protein grams, g/kg/day, whether the target was met, calories if available, fiber, saturated fat, main protein sources, supplement use, satiety or hunger, digestive comfort, body weight if you are tracking it, training context, and any symptoms.

## Interpretation rule

Interpret results by achieved dose first, then energy balance, training context, source mix, and safety context. A positive result can be as simple as “this target was practical and improved satiety without crowding out fiber.” A negative result can be “the target was too costly, too restrictive, worsened GI comfort, or did not change the outcome I care about.”
