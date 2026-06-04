---
schemaVersion: "murph.commons.page.v1"
entityType: "protocol_variant"
key: "protocol_variant:red-yeast-rice/red-yeast-rice-for-cholesterol"
slug: "protocols/red-yeast-rice/red-yeast-rice-for-cholesterol"
title: "Red Yeast Rice For Cholesterol"
summary: "A high-caution, product-specific red yeast rice lipid experiment that tracks LDL-C over 8–12 weeks only after statin-like safety screening, product-quality checks, and clinician review when risk flags are present."
status: "draft"
quality: "usable"
hidden: true
aliases:
  - "red yeast rice for cholesterol"
  - "red yeast rice for LDL"
  - "RYR for cholesterol"
  - "RYR for LDL-C"
  - "red fermented rice for cholesterol"
  - "Monascus-fermented rice for cholesterol"
  - "Monascus purpureus rice for cholesterol"
  - "hong qu cholesterol experiment"
categories:
  - "lipids"
  - "cholesterol"
  - "cardiovascular"
  - "supplement"
  - "lab-measured"
  - "product-quality"
  - "high-caution"
  - "murph-canonical"
media:

  -
    kind: image
    relativePath: design-assets/hero-03.png
    mediaType: image/png
    caption: Red Yeast Rice For Cholesterol
relations:

  -
    type: "parent_family"
    target: "experiment_family:red-yeast-rice"
  -
    type: "primary_biomarker"
    target: "biomarker:ldl-c"
  -
    type: "secondary_biomarker"
    target: "biomarker:apolipoprotein-b"
  -
    type: "secondary_biomarker"
    target: "biomarker:non-hdl-c"
  -
    type: "secondary_biomarker"
    target: "biomarker:total-cholesterol"
  -
    type: "secondary_biomarker"
    target: "biomarker:triglycerides"
  -
    type: "secondary_biomarker"
    target: "biomarker:hdl-c"
  -
    type: "cites"
    target: "source_artifact:pmid-16260426"
  -
    type: "cites"
    target: "source_artifact:pmid-24897342"
  -
    type: "cites"
    target: "source_artifact:pmid-36351465"
  -
    type: "cites"
    target: "source_artifact:pmid-31941089"
  -
    type: "cites"
    target: "source_artifact:pmid-28093797"
  -
    type: "cites"
    target: "source_artifact:pmid-22389767"
  -
    type: "cites"
    target: "source_artifact:eur-lex-regulation-2022-860-monacolins-red-yeast-rice-2022-06-01"
  -
    type: "cites"
    target: "source_artifact:fda-dietary-supplement-ingredient-directory-red-yeast-rice-2025-05-23"
  -
    type: "cites"
    target: "source_artifact:pmid-39225455"
lineage:
  relationship: "root"
  rationale: "Murph canonical red-yeast-rice protocol for generic or monacolin-specified RYR lipid experiments; proprietary Xuezhikang/Zhibituo/Zhibitai, combination nutraceutical stacks, and Beni-koji contamination events remain adjacent or safety-boundary evidence unless a run explicitly uses that named product."
attribution:
  ownerType: "murph"
  note: "Drafted from the Red Yeast Rice For Cholesterol research run completed against the uploaded 2026-04-26 repository snapshot and canonical source ledger."
protocol:
  doseSignature: "One documented red yeast rice product; record RYR mg/day plus monacolin K/total monacolins if known; no product switching; 8–12 week lipid-panel experiment."
  target: "LDL-C lowering in a lab-measured cholesterol experiment; not cardiovascular-event prevention and not replacement for prescribed lipid therapy."
  frequency:
    sessionsPerDay: 1
    sessionsPerWeek: 7
  interventionSessionsMinimum: 56
  interventionSessionsTarget: 84
  steps:
    - "Before starting, review the safety screen. Do not start a routine self-experiment if any avoid/clinician-guidance item is positive, uncertain, or cannot be answered; route to a clinician-guided variant or do not start."
    - "Choose one red yeast rice product only after documenting brand, product name, serving size, lot/batch, expiration, retailer/country, RYR mg/day, stated or documented monacolin K or total monacolins/day if available, certificate of analysis or testing date, citrinin and relevant contaminant testing, third-party/lab testing, warning-label status, and recall/local-restriction check date."
    - "Check current local restrictions, current recalls or safety notices, hidden/additional lovastatin or adulteration warnings, daily-monacolin limits or warning-label requirements, and whether the product is making drug-like cholesterol claims. Do not proceed routinely if legality, warning-label status, contaminant status, recall status, adulteration status, or monacolin exposure is unresolved."
    - "Keep diet pattern, weight-loss plan, exercise, alcohol intake, sleep schedule, medications, and other cholesterol supplements stable for about 2 weeks before the baseline lipid panel when practical."
    - "Get a baseline lipid panel before starting; record fasting status, lab name, LDL-C calculation or direct LDL method if shown, total cholesterol, HDL-C, triglycerides, and non-HDL-C. ApoB is useful when available."
    - "After the product, safety, and local-law checks are complete, take only the documented product at the lower of the label dose or clinician-agreed plan. Do not exceed the label, do not increase the dose to chase LDL-C, and do not use a product whose stated or suspected monacolin exposure, warning-label status, recall status, adulteration status, or quality documentation fails the screen."
    - "Avoid starting, stopping, or changing statins, fibrates/gemfibrozil, ezetimibe, PCSK9 therapy, bile-acid sequestrants, niacin, berberine, fish oil, plant sterols, soluble-fiber supplements, weight-loss drugs, major diet programs, or interacting medicines/supplements during the run unless a clinician directs it. Interacting exposures include cyclosporine or transplant/immunosuppressive therapy, macrolide antibiotics, azole antifungals, HIV/HCV antivirals, fusidic acid, colchicine, danazol, nefazodone, amiodarone, verapamil/diltiazem, warfarin/coumarin anticoagulants, other strong CYP3A4/P-gp modulators, and grapefruit products."
    - "Stop the run and seek medical guidance urgently for unexplained muscle pain, tenderness, cramps, or weakness—especially with fever or unusual tiredness—dark/cola urine, very low urine output, unexpected swelling, marked fatigue, jaundice, right-upper-abdominal pain, severe nausea or vomiting, rash/hives, facial/lip/tongue swelling, breathing difficulty, or any new concerning symptom. Do not restart after a stop signal unless a clinician evaluates and explicitly clears it."
    - "Repeat the lipid panel after 8–12 weeks using the same lab and fasting pattern when possible; interpret the result together with adherence, product identity, confounders, and any safety symptoms."
  safetyNotes:
    - "Monacolin K is lovastatin-like; red yeast rice should be handled with statin-like caution rather than as a low-risk food experiment."
    - "Product quality is part of the protocol because commercial products can vary in monacolin content and may carry contaminant or hidden-drug concerns."
    - "Routine self-experiment use is not appropriate for pregnancy, trying to conceive, lactation, children or teenagers, older/frail adults with polypharmacy, active or unexplained liver disease, untreated hypothyroidism, significant kidney disease or kidney failure, renal-transplant or immunosuppressed states, unexplained muscle symptoms or prior statin-associated muscle symptoms/rhabdomyolysis, known allergy to lovastatin/statins/red yeast rice, or people using interacting medicines without clinician supervision."
  tips:
    - "Prefer lot-specific monacolin and citrinin documentation; capsule weight alone is not an active-dose measure."
    - Photo the Supplement Facts panel, lot code, and any COA for the experiment record.
    - Schedule the follow-up lab before starting so the 8-12 week window does not drift.
    - "Null LDL-C change? Could be product potency, adherence, baseline level, diet shift, or lab variability."
  keepInMind:
    - "Direct evidence supports product-specific short-term LDL-C and total-cholesterol lowering in some RYR preparations, but modern commercial products are not interchangeable."
    - "Evidence for triglycerides, HDL-C, ApoB, and lipid ratios is more mixed or less consistently direct than for LDL-C and total cholesterol."
    - "SPORT provides an important null boundary: one short modern commercial supplement arm did not significantly lower LDL-C versus placebo over 28 days."
    - "Xuezhikang, Zhibituo, Zhibitai, and multi-ingredient nutraceutical stacks are adjacent evidence, not proof for generic over-the-counter RYR."
  logFields:
    - "product brand and lot"
    - "RYR mg per day"
    - "monacolin K or total monacolins if known"
    - "citrinin or third-party testing status"
    - "serving taken or missed"
    - "fasting status for labs"
    - "LDL-C"
    - "total cholesterol"
    - "HDL-C"
    - "triglycerides"
    - "non-HDL-C"
    - "ApoB if available"
    - "diet or weight change"
    - "medication or supplement changes"
    - "alcohol intake"
    - "muscle symptoms"
    - "dark urine or weakness"
    - "liver or kidney symptoms"
    - "expiration date"
    - "retailer and country"
    - "COA date or testing date"
    - "warning-label status"
    - "recall-check date"
    - "local-law check date"
    - "hidden-drug/adulteration warning check"
    - "temporary interacting medicines"
    - "grapefruit exposure"
    - "heavy alcohol exposure"
    - "vigorous exercise or muscle injury near symptom or CK events"
    - "dehydration or acute illness"
    - "thyroid or endocrine changes"
    - "pregnancy possibility where relevant"
    - "safety-lab changes"
    - "cardiovascular-risk diagnosis or clinician-directed lipid-care plan changes"
  sessionFieldIds:
  - serving-taken
  - product-identity
  - ryr-mg-day
  - monacolin-info
  - muscle-symptoms
  - medication-changes
  - diet-weight-changes
  stopConditions:
    - "Stop the run and seek medical guidance for severe, unusual, or unexplained muscle pain, tenderness, cramps, weakness, fever with muscle symptoms, unusual tiredness with muscle symptoms, dark/cola urine, or suspected rhabdomyolysis."
    - "Stop and seek guidance for jaundice, right-upper-abdominal pain, severe nausea or vomiting, marked fatigue, pale stools, or other liver concern."
    - "Stop and seek guidance for very low urine output, unexpected swelling, flank pain, acute kidney symptoms, abnormal kidney labs, or clinician concern for kidney injury."
    - "Stop for rash, hives, allergic symptoms, facial/lip/tongue swelling, or breathing difficulty; breathing difficulty or facial/tongue swelling should be treated as urgent/emergency symptoms."
    - "Stop if ALT, AST, CK, creatinine, or eGFR is abnormal or worsening; do not start routinely if baseline safety labs are abnormal or clinically concerning."
    - "Stop if a new liver, kidney, muscle, or untreated thyroid disease is diagnosed during the run."
    - "Stop if pregnancy occurs or is suspected."
    - "Stop if a clinician starts, stops, or changes a lipid-lowering medicine or an interacting medicine, acute illness requires antibiotics, antifungals, antivirals, fusidic acid, colchicine, or other interacting treatment, or new grapefruit/heavy-alcohol exposure occurs unless continuation is clinician-supervised."
    - "Stop if there is a product recall, contamination notice, hidden-drug/adulteration warning, failed local-law/warning-label check, suspected adulteration, or inability to verify product identity."
    - "Do not restart after any stop signal unless a clinician evaluates and explicitly clears restarting."
testPlans:

  -
    planId: "lipid-panel-98d"
    durationDays: 98
    baselineDays: 14
    interventionDays: 84
    primaryBiomarkerKey: "biomarker:ldl-c"
    secondaryBiomarkerKeys:
      - "biomarker:apolipoprotein-b"
      - "biomarker:non-hdl-c"
      - "biomarker:total-cholesterol"
      - "biomarker:triglycerides"
      - "biomarker:hdl-c"
    safetyOutcomeKeys:
      - "biomarker:alanine-aminotransferase"
      - "biomarker:aspartate-aminotransferase"
      - "biomarker:creatine-kinase"
      - "biomarker:serum-creatinine"
      - "biomarker:egfr"
    minimumAdherenceSessions: 56
    targetAdherenceSessions: 84
    notes:
      - "Use a baseline lipid panel before the first dose and a follow-up lipid panel after 8–12 intervention weeks."
      - "Use the same lab and fasting pattern when practical; log LDL-C calculation method or direct LDL-C if shown."
      - "Safety labs are not LDL-C endpoints and should not be used to self-clear risk. If any risk flag is present or clinician guidance is needed, the clinician-guided variant should specify baseline and follow-up or symptom-triggered ALT, AST, creatinine/eGFR, and CK when muscle symptoms, prior statin intolerance, kidney risk, liver risk, or interacting medicines are relevant. With a fully negative screen, document whether baseline ALT/AST and creatinine/eGFR are available; stop and route to care for abnormal or worsening safety labs."
expectedSignalDescriptions:

  -
    biomarkerKey: "biomarker:ldl-c"
    description: "Monacolin K inhibits liver cholesterol synthesis, increasing LDL-receptor clearance and pulling LDL particles out of blood."
    expected: "Likely lower"
    expectedDirection: down
    estimatedChange:
      kind: "absolute"
      low: -40
      high: -20
      unit: "mg/dL"
      window: "8–12 weeks"
      confidence: "moderate"
      basis: "Direct RYR trials and syntheses report LDL-C reductions around −34 to −39 mg/dL versus placebo, with several 8–12 week trials showing about 15–28% lower LDL-C; product-specific commercial null data keep confidence moderate."
    protocolProminence: "focus"
  -
    biomarkerKey: "biomarker:apolipoprotein-b"
    description: "Each LDL-related particle carries one ApoB; receptor-driven particle clearance lowers ApoB alongside LDL particles."
    expected: "Could fall"
    expectedDirection: down
    estimatedChange:
      kind: "relative_percent"
      low: -25
      high: -10
      unit: "%"
      window: "8–12 weeks"
      confidence: "low"
      basis: "ApoB fell 14–26% in direct RYR-only or separable monacolin-arm trials, but fewer studies measured it and a recent synthesis did not find ApoB consistently reduced."
    protocolProminence: "focus"
  -
    biomarkerKey: "biomarker:non-hdl-c"
    description: "Non-HDL-C falls when LDL and other ApoB-containing particles clear faster while HDL stays stable."
    expected: "Could fall"
    expectedDirection: down
    estimatedChange:
      kind: "absolute"
      low: -40
      high: -20
      unit: "mg/dL"
      window: "8–12 weeks"
      confidence: "low"
      basis: "Best estimate is inferred from LDL-C and total-cholesterol reductions with generally stable HDL-C; the extracted direct RYR corpus did not provide a clean pooled non-HDL-C estimate."
    protocolProminence: "focus"
  -
    biomarkerKey: "biomarker:total-cholesterol"
    description: "LDL-C makes up much of total cholesterol, so LDL clearance pulls total cholesterol down too."
    expected: "Likely lower"
    expectedDirection: down
    estimatedChange:
      kind: "absolute"
      low: -45
      high: -25
      unit: "mg/dL"
      window: "8–12 weeks"
      confidence: "moderate"
      basis: "Direct trials and RYR syntheses commonly report total-cholesterol reductions near −37 mg/dL or roughly 11–22% over short follow-up windows."
    protocolProminence: "focus"
  -
    biomarkerKey: "biomarker:triglycerides"
    description: "Lower liver cholesterol synthesis reduces VLDL assembly and secretion, lowering fasting triglyceride traffic."
    expected: "May decrease"
    expectedDirection: down
    estimatedChange:
      kind: "absolute"
      low: -25
      high: -5
      unit: "mg/dL"
      window: "8–12 weeks"
      confidence: "low"
      basis: "A placebo-controlled RYR meta-analysis found triglycerides about −0.23 mmol/L, or −20 mg/dL, while individual trials and later syntheses show more variable triglyceride effects than LDL-C."
    protocolProminence: "context"
  -
    biomarkerKey: "biomarker:hdl-c"
    description: "RYR targets LDL production and clearance rather than HDL formation, leaving HDL mostly stable."
    expected: "Usually stable"
    expectedDirection: mixed_or_contextual
    estimatedChange:
      kind: "absolute"
      low: -3
      high: 5
      unit: "mg/dL"
      window: "8–12 weeks"
      confidence: "mixed"
      basis: "Several direct syntheses found no significant HDL-C increase, while some older or product-specific trials reported HDL-C gains."
    protocolProminence: "context"
experimentOnboarding:
  schemaVersion: "murph.commons.experiment-onboarding.v2"
  startIntent:
    displayPrompt: "I want to plan a red yeast rice cholesterol experiment."
    intentSummary: "Plan a high-caution, product-specific RYR lipid-panel experiment with safety screening before any run is created."
  safetyScreen:
    dispositionIfAnyPositive: "clinician_guidance_before_unsupervised_start"
    mustAsk:
      - id: "pregnancy-lactation-pediatric"
        prompt: "Are you pregnant, trying to become pregnant, breastfeeding, or planning this for a child or teenager?"
        ifPositive: "do_not_start_unsupervised"
      - id: "liver-kidney-muscle-risk"
        prompt: "Do you have liver disease or unexplained liver symptoms; kidney disease, kidney failure, kidney transplant, significant kidney-function abnormality, or prior acute kidney injury; untreated hypothyroidism; muscle disease, unexplained muscle pain/tenderness/weakness, prior CK elevation, prior rhabdomyolysis, any prior statin-associated muscle symptoms or statin intolerance, or known allergy to lovastatin/statins/red yeast rice?"
        ifPositive: "clinician_guidance_before_unsupervised_start"
      - id: "high-risk-clinical-care"
        prompt: "Do you have known ASCVD, prior heart attack or stroke, familial hypercholesterolemia, very high LDL-C, very high triglycerides, diabetes, chronic kidney disease, or another condition requiring clinician-directed lipid care?"
        ifPositive: "clinician_guidance_before_unsupervised_start"
      - id: "interacting-medications"
        prompt: "Are you taking or likely to start a statin, fibrate/gemfibrozil, niacin, ezetimibe, PCSK9 therapy, bile-acid sequestrant, other lipid-lowering medicine/supplement, cyclosporine or transplant/immunosuppressive therapy, macrolide antibiotic, azole antifungal, HIV/HCV antiviral, fusidic acid, colchicine, danazol, nefazodone, amiodarone, verapamil/diltiazem, warfarin/coumarin anticoagulant, strong CYP3A4/P-gp medicine, or regular grapefruit product?"
        ifPositive: "clinician_guidance_before_unsupervised_start"
      - id: "alcohol-grapefruit-or-acute-illness"
        prompt: "Do you use heavy alcohol, grapefruit products, or have an acute illness that could affect liver, kidney, or muscle safety?"
        ifPositive: "clinician_guidance_before_unsupervised_start"
      - id: "replacing-prescribed-care"
        prompt: "Are you planning to replace, pause, or avoid prescribed lipid-lowering therapy with red yeast rice?"
        ifPositive: "clinician_guidance_before_unsupervised_start"
      - id: "product-quality-law-check"
        prompt: "Is any product identity, lot/batch, expiration date, retailer/country, monacolin K or total monacolins if stated, citrinin/contaminant testing or COA status, warning-label status, current recall/safety-notice check, hidden-drug/adulteration warning check, or local-law check missing or uncertain for this product?"
        ifPositive: "do_not_start_unsupervised"
    stopIf:
      additionalConditions:
        - "product recall, contamination notice, hidden-drug warning, suspected adulteration, or failed local-law check"
        - "new severe, unusual, or unexplained muscle symptoms, fever/tiredness with muscle symptoms, or dark/cola urine"
        - "new kidney warning symptoms including very low urine output, unexpected swelling, flank pain, or abnormal kidney labs"
        - "rash, hives, facial/lip/tongue swelling, breathing difficulty, or other allergic symptoms"
        - "abnormal or worsening ALT, AST, CK, creatinine, or eGFR"
        - "new interacting medicine, acute illness requiring interacting antimicrobial/colchicine/fusidic acid therapy, grapefruit, or heavy-alcohol exposure"
        - "do not restart after a stop signal unless a clinician explicitly clears restarting"
  setupSlots:
    - id: "product-identity"
      label: "Product identity"
      question: "What exact red yeast rice product, brand, serving size, lot/batch, expiration date, retailer, and country will you use?"
      target:
        object: "experimentRun"
        field: "productIdentity"
    - id: "active-dose-info"
      label: "Active-dose information"
      question: "What RYR mg/day and monacolin K or total monacolins/day are stated or documented, if any?"
      target:
        object: "experimentRun"
        field: "activeDoseInfo"
    - id: "product-quality-docs"
      label: "Product-quality documentation"
      question: "What evidence do you have for citrinin/contaminant testing, third-party/lab testing, warning-label status, certificate-of-analysis review, recall/safety-notice check, hidden-drug/adulteration warning check, and local-law check?"
      target:
        object: "experimentRun"
        field: "productQualityDocs"
    - id: "baseline-lab-date"
      label: "Baseline lipid panel date"
      question: "What date was or will be the baseline lipid panel?"
      constraints:
        askWhen: "if_unknown_or_stale"
      target:
        object: "experimentRun"
        field: "baselineLabDate"
    - id: "followup-lab-window"
      label: "Follow-up lipid panel window"
      question: "When will you repeat the lipid panel, ideally 8–12 weeks after starting?"
      target:
        object: "experimentRun"
        field: "followupLabWindow"
    - id: "reminder-policy"
      label: "Reminder preference"
      question: "Would you like a daily log reminder after the run is confirmed?"
      constraints:
        optional: true
        askWhen: "at_confirmation"
      target:
        object: "experimentRun"
        field: "reminderPolicy"
  planDefaults:
    testPlanId: "lipid-panel-98d"
    firstSessionGuidance: "Confirm baseline lab, product identity, product-quality/local-law checks, safety screen, and any clinician guidance before recording the first RYR serving."
  trackingHints:
    confounderFields:
      - "lipid-medication-change"
      - "diet-change"
      - "weight-change"
      - "exercise-change"
      - "alcohol"
      - "illness"
      - "product-switch"
      - "temporary-interacting-medicines"
      - "grapefruit-exposure"
      - "heavy-alcohol-exposure"
      - "vigorous-exercise-or-muscle-injury"
      - "dehydration-or-acute-illness"
      - "thyroid-endocrine-changes"
      - "pregnancy-possibility"
      - "safety-lab-changes"
      - "product-coa-citrinin-contaminant-status"
      - "recall-check-date"
      - "local-law-check-date"
      - "cardiovascular-risk-diagnosis-change"
    notes:
      - "Log missed servings and any product change immediately; product switching invalidates a clean run."
      - "Log temporary interacting medicines, grapefruit exposure, heavy alcohol exposure, vigorous exercise or muscle injury near symptom/CK events, dehydration or acute illness, thyroid/endocrine changes, pregnancy possibility where relevant, safety-lab changes, product COA/citrinin/contaminant status, recall-check date, local-law check date, and any change in cardiovascular-risk diagnosis or clinician-directed lipid-care plan."
  supportHints:
    missedLogFollowupCopy: "A missed RYR log matters for dose attribution. Please mark taken, missed, or stopped."
whyItWorks:
  - "## Monacolin K blocks liver cholesterol synthesis\n\nMonacolin K is chemically identical to lovastatin and inhibits HMG-CoA reductase, the rate-limiting enzyme in cholesterol production. The liver compensates by upregulating LDL receptors, pulling LDL particles out of the bloodstream. This statin-like pharmacology is why the protocol requires high-caution screening rather than treating RYR as a generic food supplement."
  - "## Product identity determines whether the mechanism fires\n\nCommercial RYR products vary widely in monacolin content, contaminant profile, and active-dose documentation. Direct trials show LDL-C and total-cholesterol lowering for documented preparations, but a specific commercial supplement arm in SPORT showed no significant LDL-C change over 28 days. The signal is product-specific, not category-wide."
  - "## LDL-C is a lab endpoint, not a felt symptom\n\nThe expected signal is a lipid-panel biomarker shift, not a same-day experience change. A baseline and 8-12 week follow-up lipid panel with fasting status, lab method, adherence, product identity, and confounder logs visible is the only way to interpret whether this product moved cholesterol handling."
mechanismChain:
  -
    label: "Dose"
    content: "1 documented RYR product · monacolin K or total monacolins logged · daily for 8-12 weeks"
  -
    label: "Acute effect"
    content: "Monacolin K inhibits HMG-CoA reductase; liver cholesterol synthesis drops"
  -
    label: "Repeated signal"
    content: "Sustained synthesis block forces liver to upregulate LDL-receptor expression"
  -
    label: "Adaptation"
    content: "LDL-C and total cholesterol fall; magnitude depends on product potency, dose, and baseline level"
claims:

  -
    claimId: "direct-short-term-ldl-total-cholesterol"
    type: "intervention_result"
    text: "Direct RYR-only and clearly separable RYR/monacolin arms support that some documented preparations can lower LDL-C and total cholesterol over short windows, often around 8–12 weeks, but evidence is product-, dose-, population-, comparator-, and cointervention-dependent."
    strength: "moderate"
    sourceKeys:
      - "source_artifact:pmid-16260426"
      - "source_artifact:pmid-20636227"
      - "source_artifact:pmid-23866314"
      - "source_artifact:pmid-24897342"
      - "source_artifact:pmid-25897793"
      - "source_artifact:pmid-35111069"
    caveats:
      - "Product identity, monacolin exposure, baseline population, comparator type, cointerventions, and test duration matter; do not generalize the effect to every commercial RYR product."
  -
    claimId: "sport-null-commercial-boundary"
    type: "mixed_evidence"
    text: "A single modern 28-day SPORT trial found no significant LDL-C reduction versus placebo for a specific commercial red yeast rice supplement arm; use it as a null boundary for short-duration commercial supplement claims, not as a universal null result for monacolin-characterized RYR."
    strength: "low"
    sourceKeys:
      - "source_artifact:pmid-36351465"
      - "source_artifact:acc-sport-supplements-rosuvastatin-2022-11-06"
    caveats:
      - "SPORT was short and product-specific; it does not disprove all monacolin-active RYR preparations."
      - "It does warn against assuming any marketed product will lower LDL-C."
  -
    claimId: "secondary-lipids-mixed"
    type: "mixed_evidence"
    text: "Triglycerides, HDL-C, ApoB, non-HDL-C, and lipid ratios should stay secondary or contextual: triglycerides and ApoB improved in some direct studies, HDL-C was often unchanged or not significant, and the extracted direct RYR-only corpus did not provide a completed non-HDL-C efficacy estimate."
    strength: "low"
    sourceKeys:
      - "source_artifact:pmid-16260426"
      - "source_artifact:pmid-17568245"
      - "source_artifact:pmid-24897342"
      - "source_artifact:pmid-25897793"
      - "source_artifact:pmid-38794691"
      - "source_artifact:clinicaltrials-nct06368258-2026-04-26"
    caveats:
      - "ApoB and ratio outcomes should be treated as secondary or optional personal signals unless the run is designed around them."
      - "The non-HDL-C statement is a coverage statement about the extracted corpus, not proof that no non-HDL-C evidence exists elsewhere."
  -
    claimId: "capsule-weight-not-active-dose"
    type: "design_guardrail"
    text: "RYR capsule mass is not the same as active dose; monacolin K or total monacolins and contaminant testing should be logged whenever available."
    strength: "high"
    sourceKeys:
      - "source_artifact:pmid-11327519"
      - "source_artifact:pmid-20975018"
      - "source_artifact:pmid-28641460"
      - "source_artifact:pmid-31941089"
      - "source_artifact:pmid-38928859"
    caveats:
      - "If active-dose or contaminant documentation is absent, do not make a routine LDL-C efficacy or safety claim for the run. Either obtain product documentation and complete the safety screen, route to clinician guidance, or treat the record as a low-confidence exposure log with no dose-response interpretation."
  -
    claimId: "no-product-switching"
    type: "design_guardrail"
    text: "Product switching during the intervention invalidates clean attribution because RYR products can differ in monacolin content, coingredients, and contamination profile."
    strength: "high"
    sourceKeys:
      - "source_artifact:pmid-31941089"
      - "source_artifact:pmid-34357969"
      - "source_artifact:pmid-34950692"
      - "source_artifact:pmid-37297387"
    caveats:
      - "If a product switch is medically or practically necessary, end the current run and treat the new product as a separate experiment."
  -
    claimId: "citrinin-hidden-drug-quality-boundary"
    type: "safety"
    text: "Citrinin contamination, hidden or added lovastatin-like drug content, and product-quality uncertainty are core safety boundaries for RYR experiments, but citrinin findings are market-, method-, and lot-dependent."
    strength: "high"
    sourceKeys:
      - "source_artifact:pmid-31941089"
      - "source_artifact:pmid-38928859"
      - "source_artifact:pmid-34357969"
      - "source_artifact:pmid-37297387"
      - "source_artifact:eur-lex-regulation-2023-915-citrinin-red-yeast-rice-2023-04-25"
      - "source_artifact:fda-carbon-isotope-adulteration-red-yeast-rice-2021-05-26"
      - "source_artifact:fda-red-yeast-rice-products-warning-2007-08-09"
    caveats:
      - "Some surveys found frequent contamination, while others found no citrinin above the reported detection method; no product or later lot should be cleared without product-specific documentation."
      - "Product-quality sources are safety and attribution evidence, not direct proof that the product lowers LDL-C."
  -
    claimId: "statin-like-safety-screen"
    type: "safety"
    text: "Because monacolin K is lovastatin-like, RYR requires statin-like screening for muscle, liver, kidney, pregnancy/lactation, pediatric, medication-overlap, and interaction risks."
    strength: "high"
    sourceKeys:
      - "source_artifact:fda-dietary-supplement-ingredient-directory-red-yeast-rice-2025-05-23"
      - "source_artifact:nccih-red-yeast-rice-2026-04-26"
      - "source_artifact:pmid-28093797"
      - "source_artifact:pmid-31118742"
      - "source_artifact:pmid-31643497"
      - "source_artifact:pmid-32626016"
      - "source_artifact:pmid-37831308"
      - "source_artifact:anses-red-yeast-rice-risks-2014-03-12"
    caveats:
      - "Short RCT tolerability findings do not rule out rare or product-specific adverse events."
      - "Do not treat a supplement label or low monacolin exposure as a self-clearance threshold for unsupervised use."
  -
    claimId: "short-term-safety-mixed"
    type: "mixed_evidence"
    text: "Short-term RYR trials and meta-analyses are often reassuring for common adverse events and routine CK, liver, or kidney lab signals, but case reports and pharmacovigilance sources show plausible serious muscle, liver, and kidney events and cannot provide incidence rates for a specific product."
    strength: "low"
    sourceKeys:
      - "source_artifact:pmid-24897342"
      - "source_artifact:pmid-35111069"
      - "source_artifact:pmid-31643497"
      - "source_artifact:pmid-37831308"
    caveats:
      - "Short RCTs do not establish long-term or rare-event safety."
      - "Spontaneous-report and case-report data cannot estimate incidence."
  -
    claimId: "interaction-boundary"
    type: "safety"
    text: "RYR interaction risk is plausible with overlapping lipid-lowering drugs and CYP3A4/P-gp-related exposures, including strong interacting medicines, transplant/immunosuppressive therapy, warfarin/coumarins, colchicine, danazol, nefazodone, fusidic acid, and grapefruit products."
    strength: "moderate"
    sourceKeys:
      - "source_artifact:drugs-com-red-yeast-rice-2025-05-14"
      - "source_artifact:mskcc-red-yeast-rice-2023-02-03"
      - "source_artifact:pdr-cyclosporine-red-yeast-rice-2026-04-26"
      - "source_artifact:clevelandclinic-red-yeast-rice-2026-04-26"
      - "source_artifact:pmid-22389767"
      - "source_artifact:pmid-23227093"
      - "source_artifact:pmid-28883839"
    caveats:
      - "Interaction sources support a screening boundary; they do not quantify individualized risk for a specific product."
  -
    claimId: "clinical-lipid-care-boundary"
    type: "safety"
    text: "RYR should not be presented as a statin substitute or cardiovascular-event-prevention replacement for people with known ASCVD, prior myocardial infarction or stroke, familial hypercholesterolemia, very high LDL-C, very high triglycerides, diabetes, chronic kidney disease, or another clinician-directed lipid-care indication."
    strength: "high"
    sourceKeys:
      - "source_artifact:healthquality-va-dod-lipid-management-2025-12-01"
      - "source_artifact:pmid-32956597"
      - "source_artifact:pmid-40878289"
      - "source_artifact:pmid-41824552"
      - "source_artifact:pmid-41651774"
      - "source_artifact:pmid-35718660"
      - "source_artifact:acc-role-nutraceuticals-statin-intolerant-2018-06-28"
    caveats:
      - "These sources support routing high-risk lipid contexts to clinical care; they do not evaluate the user’s individual cardiovascular risk."
  -
    claimId: "regulatory-availability-boundary"
    type: "evidence_scope"
    text: "RYR rules and claims differ by jurisdiction, and EU and US sources create important boundaries around monacolin exposure, revoked or refused EU health-claim status, and drug-like lovastatin content."
    strength: "high"
    sourceKeys:
      - "source_artifact:eur-lex-regulation-2022-860-monacolins-red-yeast-rice-2022-06-01"
      - "source_artifact:eur-lex-regulation-2024-2041-monacolin-k-health-claim-2024-07-29"
      - "source_artifact:eur-lex-regulation-2024-2063-monacolin-k-health-claim-2024-07-30"
      - "source_artifact:fda-dietary-supplement-ingredient-directory-red-yeast-rice-2025-05-23"
      - "source_artifact:pmid-32626016"
      - "source_artifact:pmid-40027377"
    caveats:
      - "The protocol should not imply current legality, authorization, or product availability in a user’s market."
      - "Historical EU LDL-C substantiation at higher monacolin exposure should not be converted into current consumer health-claim or dose language."
  -
    claimId: "adjacent-xuezhikang-not-generic-ryr"
    type: "evidence_scope"
    text: "Xuezhikang, Zhibituo, and Zhibitai evidence should be kept as adjacent proprietary-preparation evidence and not used as direct proof for generic RYR supplements."
    strength: "high"
    sourceKeys:
      - "source_artifact:pmid-18549841"
      - "source_artifact:pmid-25499939"
      - "source_artifact:pmid-34762365"
      - "source_artifact:pmid-32899044"
      - "source_artifact:pmid-36120312"
      - "source_artifact:pmid-39108747"
    caveats:
      - "Cardiovascular-event findings from proprietary Chinese preparations should not be transferred to this generic cholesterol biomarker protocol."
  -
    claimId: "adjacent-combinations-not-attributable"
    type: "evidence_scope"
    text: "Multi-ingredient nutraceutical stacks containing RYR are adjacent evidence; LDL-C changes from those studies cannot be attributed to standalone RYR without a RYR-only arm."
    strength: "high"
    sourceKeys:
      - "source_artifact:pmid-19699071"
      - "source_artifact:pmid-26649075"
      - "source_artifact:pmid-28704936"
      - "source_artifact:pmid-33066334"
      - "source_artifact:pmid-37732047"
    caveats:
      - "These sources can inform safety, coingredient, and hypothesis context but should not define the Murph canonical protocol dose."
  -
    claimId: "lipid-panel-measurement-plan"
    type: "design_guardrail"
    text: "A credible RYR cholesterol experiment needs a baseline and follow-up lipid panel, visible fasting and lab-method context, and logs for adherence, product identity, diet, weight, exercise, and medication changes."
    strength: "moderate"
    sourceKeys:
      - "source_artifact:pmid-39225455"
      - "source_artifact:pmid-34802986"
      - "source_artifact:pmid-27122601"
      - "source_artifact:nice-ng238-lipid-modification-2025-09-02"
      - "source_artifact:pmid-39256087"
    caveats:
      - "Lab measurement context does not prove RYR efficacy; it protects interpretation of an individual run."
safety:
  cautionLevel: "high"
  avoidOrGetClinicianGuidance:
    - pregnancy_trying_to_conceive_or_breastfeeding
    - pediatric_or_adolescent
    - older_or_frail_adult_with_polypharmacy
    - known_ascvd_or_prior_heart_attack_stroke
    - familial_hypercholesterolemia
    - very_high_ldl_or_triglycerides
    - diabetes
    - chronic_kidney_disease_or_kidney_failure
    - active_liver_disease_or_abnormal_liver_enzymes
    - heavy_alcohol_use_or_untreated_hypothyroidism
    - kidney_transplant_or_immunosuppressed
    - unexplained_muscle_pain_or_prior_rhabdomyolysis
    - statin_intolerance_or_prior_ck_elevation
    - lovastatin_statin_or_ryr_allergy
    - concurrent_lipid_lowering_therapy
    - cyclosporine_or_strong_cyp3a4_inhibitor
    - warfarin_or_coumarin_anticoagulant
    - macrolide_azole_or_hiv_hcv_antiviral
    - regular_grapefruit_consumption
    - intent_to_replace_prescribed_lipid_therapy
    - product_lacks_identity_or_batch_verification
    - product_lacks_citrinin_or_coa_documentation
  stopIf:
    - "severe, unusual, or unexplained muscle pain, tenderness, cramps, weakness, fever with muscle symptoms, unusual tiredness with muscle symptoms, dark/cola urine, or suspected rhabdomyolysis"
    - "jaundice, right-upper-abdominal pain, severe nausea or vomiting, marked fatigue, pale stools, or other liver concern"
    - "very low urine output, unexpected swelling, flank pain, acute kidney symptoms, abnormal kidney labs, or clinician concern for kidney injury"
    - "rash, hives, allergic symptoms, facial/lip/tongue swelling, or breathing difficulty; breathing difficulty or facial/tongue swelling should be treated as urgent/emergency symptoms"
    - "abnormal or worsening ALT, AST, CK, creatinine, or eGFR; abnormal baseline safety labs before first dose; or new diagnosis of liver, kidney, muscle, or untreated thyroid disease"
    - "pregnancy occurs or is suspected"
    - "a clinician starts, stops, or changes a lipid-lowering medicine or an interacting medicine"
    - "acute illness requires antibiotics, antifungals, antivirals, fusidic acid, colchicine, or other interacting treatment"
    - "new grapefruit or heavy-alcohol exposure occurs unless the run is clinician-supervised"
    - "product recall, contamination notice, hidden-drug/adulteration warning, failed local-law/warning-label check, suspected adulteration, or inability to verify product identity"
    - "do not restart after any stop signal unless a clinician evaluates and explicitly clears restarting"
  notes:
    - "Safety intentionally stronger than efficacy — RYR is pharmacologically active and product-variable."
    - "Safety labs are not LDL-C endpoints — abnormal or worsening ALT, AST, CK, creatinine, or eGFR routes to care."
    - "Case reports show plausible serious events but cannot provide incidence rates for a specific product."
    - "Beni-koji kidney injury events are product-specific safety context, not efficacy evidence for generic RYR."
researchLandscape:
  bottomLine: "The direct protocol evidence is moderate for short-term LDL-C and total-cholesterol lowering with some RYR preparations, but the protocol must be product-specific and high-caution because monacolin exposure, commercial quality, regulatory status, and adverse-event risk vary."
  confidenceLabel: "mixed"
  primaryClaim: "Some documented RYR preparations can lower LDL-C over an 8–12 week lab-measured window."
  mainCaveat: "Do not treat a capsule label, proprietary Xuezhikang evidence, combination-stack evidence, or a historical RCT product as proof that a current commercial product will lower LDL-C safely."
  groups:

    -
      id: "direct-ryr-lipid-trials"
      label: "Direct RYR lipid trials"
      stance: "supports"
      summary: "Direct RYR-only and clearly separable RYR/monacolin arms support LDL-C and total-cholesterol lowering for several specific preparations, mostly over 8–16 weeks; comparator type, cointerventions, monacolin content, population, and product identity limit generalization."
      sourceKeys:
        - "source_artifact:doi-10.1016-s0011-393x-97-80063-x"
        - "source_artifact:pmid-16260426"
        - "source_artifact:pmid-17568245"
        - "source_artifact:pmid-19528562"
        - "source_artifact:pmid-20636227"
        - "source_artifact:pmid-23866314"
        - "source_artifact:pmid-23890351"
        - "source_artifact:pmid-27865358"
        - "source_artifact:pmid-29021813"
        - "source_artifact:pmid-30871361"
        - "source_artifact:pmid-34587702"
        - "source_artifact:pmid-9989685"
        - "source_artifact:pmid-16338198"
        - "source_artifact:pmid-20102918"
        - "source_artifact:pmid-20185013"
        - "source_artifact:clinicaltrials-nct00405769-2026-04-26"
        - "source_artifact:clinicaltrials-nct00639223-2026-04-26"
        - "source_artifact:clinicaltrials-nct01385020-2026-04-26"
        - "source_artifact:clinicaltrials-nct06368258-2026-04-26"
        - "source_artifact:clinicaltrials-nct06750783-2024-12-31"
        - "source_artifact:pmid-28521773"
        - "source_artifact:pmid-40486958"
        - "source_artifact:researchgate-cholestin-americans-2013-01-01"
      defaultOpen: true
    -
      id: "commercial-short-duration-null-boundary"
      label: "Commercial short-duration null boundary"
      stance: "mixed"
      summary: "SPORT and ACC coverage are context-only boundary evidence: one modern 28-day supervised commercial red yeast rice supplement arm did not significantly lower LDL-C versus placebo, while rosuvastatin did. Use this to block blanket product claims, not to override monacolin-characterized RYR evidence."
      sourceKeys:
        - "source_artifact:acc-sport-supplements-rosuvastatin-2022-11-06"
        - "source_artifact:pmid-36351465"
      defaultOpen: true
    -
      id: "direct-ryr-lipid-syntheses"
      label: "Reviews and meta-analyses"
      stance: "supports"
      summary: "Evidence syntheses generally support a lipid-lowering signal for RYR, but they pool heterogeneous preparations, populations, and comparators; sources with abstract-only or paywall-limited extraction should be used as context rather than numeric anchors."
      sourceKeys:
        - "source_artifact:pmid-17302963"
        - "source_artifact:pmid-24897342"
        - "source_artifact:pmid-25897793"
        - "source_artifact:pmid-28749884"
        - "source_artifact:pmid-35111069"
        - "source_artifact:pmid-36259545"
        - "source_artifact:pmid-38794691"
        - "source_artifact:pmid-41681060"
        - "source_artifact:doi-10.1016-j.jfutfo.2023.03.003"
        - "source_artifact:doi-10.3390-foods15071146"
        - "source_artifact:pmid-19572049"
        - "source_artifact:pmid-31137594"
        - "source_artifact:pmid-31451336"
        - "source_artifact:pmid-31849687"
        - "source_artifact:pmid-35988871"
        - "source_artifact:pmid-37240523"
        - "source_artifact:pmid-39511729"
        - "source_artifact:pmid-40881894"
      defaultOpen: true
    -
      id: "product-quality-dose-uncertainty"
      label: "Product quality and active-dose uncertainty"
      stance: "safety_boundary"
      summary: "Analytical and regulatory sources show why product identity, monacolin content, citrinin testing, adulteration checks, and no product switching are central to the protocol; some surveys find citrinin while others report no detectable citrinin under their methods."
      sourceKeys:
        - "source_artifact:cfs-red-fermented-rice-food-safety-2026-04-26"
        - "source_artifact:doi-10.1016-j.foodcont.2013.10.016"
        - "source_artifact:doi-10.2183-pjab.101.017"
        - "source_artifact:doi-10.3390-molecules31010016"
        - "source_artifact:mayoclinic-red-yeast-rice-2025-03-27"
        - "source_artifact:pmid-11327519"
        - "source_artifact:pmid-20975018"
        - "source_artifact:pmid-23265521"
        - "source_artifact:pmid-23305336"
        - "source_artifact:pmid-25168220"
        - "source_artifact:pmid-31410535"
        - "source_artifact:pmid-34357969"
        - "source_artifact:pmid-38843711"
        - "source_artifact:pmid-38928859"
        - "source_artifact:anses-red-yeast-rice-food-supplements-2014-03-12"
        - "source_artifact:anses-red-yeast-rice-supplements-warning-2014-08-29"
        - "source_artifact:doi-10.1016-j.jfca.2025.107391"
        - "source_artifact:doi-10.17590-20200205-121500"
        - "source_artifact:healthquality-va-dod-lipid-management-2025-12-01"
        - "source_artifact:pmid-15336357"
        - "source_artifact:pmid-21712404"
        - "source_artifact:pmid-21943718"
        - "source_artifact:pmid-22439629"
        - "source_artifact:pmid-27567407"
        - "source_artifact:pmid-28093797"
        - "source_artifact:pmid-28361160"
        - "source_artifact:pmid-28641460"
        - "source_artifact:pmid-28738573"
        - "source_artifact:pmid-31118742"
        - "source_artifact:pmid-31941089"
        - "source_artifact:pmid-33538260"
        - "source_artifact:pmid-34950692"
        - "source_artifact:pmid-35901940"
        - "source_artifact:pmid-37297387"
        - "source_artifact:pmid-37625290"
        - "source_artifact:pmid-41752500"
      defaultOpen: true
    -
      id: "safety-adverse-events"
      label: "Safety reviews, pharmacovigilance, and case reports"
      stance: "safety_boundary"
      summary: "Safety sources support statin-like screening and stop rules for muscle, liver, kidney, pregnancy/lactation, pediatric, medication-overlap, allergy, thyroid, transplant/immunosuppression, and interaction concerns; case reports and surveillance signals should not be interpreted as incidence estimates."
      sourceKeys:
        - "source_artifact:pmid-31643497"
        - "source_artifact:pmid-32626016"
        - "source_artifact:pmid-40027377"
        - "source_artifact:anses-red-yeast-rice-risks-2014-03-12"
        - "source_artifact:clevelandclinic-red-yeast-rice-2026-04-26"
        - "source_artifact:drugs-com-red-yeast-rice-warnings-2025-04-28"
        - "source_artifact:lipid-org-red-yeast-rice-alternative-therapy-2016-01-01"
        - "source_artifact:pmid-18637891"
        - "source_artifact:pmid-28277227"
        - "source_artifact:pmid-30844537"
        - "source_artifact:pmid-31566178"
        - "source_artifact:pmid-33085778"
        - "source_artifact:pmid-36115813"
        - "source_artifact:pmid-37831308"
        - "source_artifact:pmid-38337728"
        - "source_artifact:pmid-38413255"
        - "source_artifact:pmid-39507393"
        - "source_artifact:pmid-12438974"
        - "source_artifact:pmid-14696880"
        - "source_artifact:pmid-16983142"
        - "source_artifact:pmid-18838736"
        - "source_artifact:pmid-21291717"
        - "source_artifact:pmid-26810781"
        - "source_artifact:pmid-30910808"
        - "source_artifact:pmid-36779111"
        - "source_artifact:pmid-37637685"
        - "source_artifact:pmid-40264460"
        - "source_artifact:pmid-40909457"
        - "source_artifact:acc-role-nutraceuticals-statin-intolerant-2018-06-28"
        - "source_artifact:drugs-com-red-yeast-rice-2025-05-14"
        - "source_artifact:mskcc-red-yeast-rice-2023-02-03"
        - "source_artifact:pdr-cyclosporine-red-yeast-rice-2026-04-26"
        - "source_artifact:pmid-22389767"
        - "source_artifact:pmid-23227093"
        - "source_artifact:pmid-28601545"
        - "source_artifact:pmid-29957236"
        - "source_artifact:pmid-35718660"
        - "source_artifact:rxlist-red-yeast-rice-2026-04-26"
      defaultOpen: true
    -
      id: "regulatory-jurisdiction-warnings"
      label: "Regulatory and jurisdiction boundaries"
      stance: "safety_boundary"
      summary: "EU, US, and agency sources separate legal/claim status from efficacy, including revoked or refused EU monacolin health-claim status and US drug-like lovastatin boundaries; current market checks are necessary before a run."
      sourceKeys:
        - "source_artifact:eur-lex-regulation-2019-1901-citrinin-red-yeast-rice-2019-11-07"
        - "source_artifact:eur-lex-regulation-2022-860-monacolins-red-yeast-rice-2022-06-01"
        - "source_artifact:eur-lex-regulation-2023-915-citrinin-red-yeast-rice-2023-04-25"
        - "source_artifact:fda-carbon-isotope-adulteration-red-yeast-rice-2021-05-26"
        - "source_artifact:fda-cholestene-hidden-drug-2021-07-09"
        - "source_artifact:fda-dietary-supplement-ingredient-directory-red-yeast-rice-2025-05-23"
        - "source_artifact:fda-dr-sam-robbins-red-yeast-rice-2020-08-28"
        - "source_artifact:fda-red-yeast-rice-products-warning-2007-08-09"
        - "source_artifact:health-canada-red-yeast-rice-lovastatin-alert-2007-10-25"
        - "source_artifact:justia-pharmanex-v-shalala-2000-07-21"
        - "source_artifact:kobayashi-red-yeast-rice-voluntary-collection-2024-03-22"
        - "source_artifact:mhlw-beni-koji-adverse-events-2025-03-19"
        - "source_artifact:mhlw-beni-koji-cause-investigation-2024-09-18"
        - "source_artifact:nccih-high-cholesterol-natural-products-2026-04-25"
        - "source_artifact:nccih-red-yeast-rice-2026-04-26"
        - "source_artifact:pmid-23415430"
        - "source_artifact:pmid-29582393"
        - "source_artifact:pmid-38834898"
        - "source_artifact:wto-eping-eu-monacolins-red-yeast-rice-draft-regulation-2026-03-04"
        - "source_artifact:eur-lex-regulation-2024-2041-monacolin-k-health-claim-2024-07-29"
        - "source_artifact:eur-lex-regulation-2024-2063-monacolin-k-health-claim-2024-07-30"
        - "source_artifact:fsai-ricepure-red-yeast-rice-recall-2025-06-18"
        - "source_artifact:hsa-lac-activated-heart-protect-recall-2024-04-16"
        - "source_artifact:hsa-prohibited-restricted-ingredients-red-yeast-rice-2025-10-01"
        - "source_artifact:hsa-royce-red-yeast-rice-coq10-recall-2023-11-01"
        - "source_artifact:pmid-39291198"
        - "source_artifact:pmid-39708997"
        - "source_artifact:pmid-39810787"
        - "source_artifact:tga-red-yeast-rice-schedule-4-2009-10-20"
        - "source_artifact:examine-red-yeast-rice-2024-01-03"
        - "source_artifact:pmid-27956024"
        - "source_artifact:pmid-31687098"
        - "source_artifact:pmid-32956597"
        - "source_artifact:pmid-35276964"
        - "source_artifact:pmid-37242171"
        - "source_artifact:pmid-37840633"
        - "source_artifact:pmid-37931717"
        - "source_artifact:pmid-40878289"
        - "source_artifact:pmid-41651774"
      defaultOpen: true
    -
      id: "adjacent-proprietary-preparations"
      label: "Xuezhikang/Zhibituo/Zhibitai adjacent evidence"
      stance: "context_only"
      summary: "Proprietary Chinese preparations, special clinical populations, secondary-prevention studies, and future/protocol-only sources can inform mechanism and context, but cardiovascular-event and named-product findings should not be imported into the generic Murph RYR cholesterol protocol."
      sourceKeys:
        - "source_artifact:doi-10.15212-cvia.2024.0010"
        - "source_artifact:pmid-12801622"
        - "source_artifact:pmid-15313947"
        - "source_artifact:pmid-15924803"
        - "source_artifact:pmid-16563271"
        - "source_artifact:pmid-17217713"
        - "source_artifact:pmid-17312447"
        - "source_artifact:pmid-17608873"
        - "source_artifact:pmid-18549841"
        - "source_artifact:pmid-19602720"
        - "source_artifact:pmid-20350253"
        - "source_artifact:pmid-21091365"
        - "source_artifact:pmid-22133469"
        - "source_artifact:pmid-22567033"
        - "source_artifact:pmid-25499939"
        - "source_artifact:pmid-28207527"
        - "source_artifact:pmid-29507705"
        - "source_artifact:pmid-34434972"
        - "source_artifact:pmid-34762365"
        - "source_artifact:pmid-36120312"
        - "source_artifact:pmid-36998136"
        - "source_artifact:pmid-39108747"
        - "source_artifact:pmid-39525586"
        - "source_artifact:pmid-15653117"
        - "source_artifact:pmid-17196275"
        - "source_artifact:pmid-20189174"
        - "source_artifact:pmid-22489805"
        - "source_artifact:pmid-29397593"
        - "source_artifact:pmid-29988855"
        - "source_artifact:pmid-32423930"
        - "source_artifact:clinicaltrials-nct02603276-2026-04-26"
        - "source_artifact:pmid-32819924"
        - "source_artifact:pmid-32899044"
    -
      id: "adjacent-combination-products"
      label: "Multi-ingredient nutraceutical stacks"
      stance: "context_only"
      summary: "Combination products and special-population nutraceutical studies containing RYR are not standalone RYR evidence unless they include a RYR-only arm; they should stay separate for dose, attribution, and safety interpretation."
      sourceKeys:
        - "source_artifact:doi-10.1007-s13749-015-0047-4"
        - "source_artifact:doi-10.1016-j.jff.2023.105508"
        - "source_artifact:doi-10.1016-j.phanu.2013.02.003"
        - "source_artifact:doi-10.1039-c8fo00415c"
        - "source_artifact:doi-10.3233-s12349-010-0028-5"
        - "source_artifact:drugs-com-gemfibrozil-red-yeast-rice-2026-04-26"
        - "source_artifact:pmid-18363032"
        - "source_artifact:pmid-19398239"
        - "source_artifact:pmid-19699071"
        - "source_artifact:pmid-19786378"
        - "source_artifact:pmid-22041543"
        - "source_artifact:pmid-22385548"
        - "source_artifact:pmid-22531006"
        - "source_artifact:pmid-23266743"
        - "source_artifact:pmid-23815518"
        - "source_artifact:pmid-26167669"
        - "source_artifact:pmid-26202829"
        - "source_artifact:pmid-26649075"
        - "source_artifact:pmid-27131395"
        - "source_artifact:pmid-27157250"
        - "source_artifact:pmid-27838874"
        - "source_artifact:pmid-28704936"
        - "source_artifact:pmid-29793488"
        - "source_artifact:pmid-30795775"
        - "source_artifact:pmid-31035469"
        - "source_artifact:pmid-31073102"
        - "source_artifact:pmid-32066811"
        - "source_artifact:pmid-32529103"
        - "source_artifact:pmid-33066334"
        - "source_artifact:pmid-33525601"
        - "source_artifact:pmid-33976708"
        - "source_artifact:pmid-34381916"
        - "source_artifact:pmid-35473348"
        - "source_artifact:pmid-36120360"
        - "source_artifact:pmid-37732047"
        - "source_artifact:pmid-38283922"
        - "source_artifact:pmid-38310834"
        - "source_artifact:pmid-38846105"
        - "source_artifact:pmid-39275298"
        - "source_artifact:pmid-40741249"
        - "source_artifact:pmid-16624082"
        - "source_artifact:pmid-18613992"
        - "source_artifact:pmid-20153154"
        - "source_artifact:pmid-22113535"
        - "source_artifact:pmid-22348456"
        - "source_artifact:pmid-25879228"
        - "source_artifact:pmid-26956355"
        - "source_artifact:pmid-28883839"
        - "source_artifact:pmid-35264949"
        - "source_artifact:pmid-36434733"
        - "source_artifact:pmid-38812930"
        - "source_artifact:pmid-39424254"
        - "source_artifact:pmid-41824552"
    -
      id: "lipid-measurement-test-plan"
      label: "Lipid measurement and test-plan context"
      stance: "context_only"
      summary: "Measurement sources support the lipid-panel plan, fasting and method logging, ApoB/non-HDL context, and confounder capture; they are not RYR efficacy evidence."
      sourceKeys:
        - "source_artifact:nice-ng238-lipid-modification-2025-09-02"
        - "source_artifact:pmid-25911072"
        - "source_artifact:pmid-27122601"
        - "source_artifact:pmid-30586774"
        - "source_artifact:pmid-31504418"
        - "source_artifact:pmid-32951056"
        - "source_artifact:pmid-33781847"
        - "source_artifact:pmid-34332805"
        - "source_artifact:pmid-34802986"
        - "source_artifact:pmid-35378262"
        - "source_artifact:pmid-39225455"
        - "source_artifact:pmid-39256087"
        - "source_artifact:pmid-39789723"
        - "source_artifact:pmid-41824590"
        - "source_artifact:pmid-7586510"
        - "source_artifact:pmid-7586511"
        - "source_artifact:pmid-7586512"
        - "source_artifact:cdc-cvd-reference-laboratory-2024-04-24"
        - "source_artifact:pmid-18711012"
        - "source_artifact:pmid-18955664"
        - "source_artifact:pmid-21487090"
        - "source_artifact:pmid-22527287"
        - "source_artifact:pmid-23147400"
        - "source_artifact:pmid-24240933"
        - "source_artifact:pmid-25015340"
        - "source_artifact:pmid-2538292"
        - "source_artifact:pmid-28935041"
        - "source_artifact:pmid-30522787"
        - "source_artifact:pmid-31135812"
        - "source_artifact:pmid-32101259"
        - "source_artifact:pmid-32562186"
        - "source_artifact:pmid-3338168"
        - "source_artifact:pmid-36605300"
        - "source_artifact:pmid-36650044"
        - "source_artifact:pmid-37489721"
        - "source_artifact:pmid-37624942"
        - "source_artifact:pmid-38937752"
        - "source_artifact:pmid-40681368"
        - "source_artifact:pmid-4337382"
        - "source_artifact:pmid-33842607"
      defaultOpen: true
---
Red yeast rice for cholesterol is a high-caution, product-specific lipid experiment: document the exact product, screen for statin-like safety risks, keep confounders stable, and compare baseline versus 8–12 week follow-up LDL-C on a lipid panel.

## What this protocol is

This is the Murph canonical protocol for a generic or monacolin-specified red yeast rice cholesterol experiment. It is meant to answer a narrow personal question: did this documented product, used consistently for this run, move LDL-C or related lipids?

It is not a cardiovascular-event-prevention protocol, a statin substitute, a recommendation to buy any specific supplement, or a way to transfer Xuezhikang/Zhibituo/Zhibitai or combination-stack findings onto ordinary commercial RYR.

## What to measure

Primary signal: LDL-C. Secondary signals: ApoB when available, non-HDL-C, total cholesterol, triglycerides, and HDL-C. Record fasting status, lab, LDL-C method, adherence, product identity, dose documentation, diet or weight change, exercise change, and medication or supplement changes.

## Safety stance

Treat RYR as an active, statin-like exposure when monacolins are present. The protocol should block frictionless onboarding whenever safety, medication, pregnancy/lactation, liver, kidney, muscle, product-quality, recall, adulteration, or local-regulatory questions are unresolved.
