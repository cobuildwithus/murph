---
schemaVersion: murph.commons.page.v1
entityType: goal_template
key: goal_template:protect-kidney-function
slug: protect-kidney-function
title: Protect My Kidney Function
summary: Slow preventable kidney damage by controlling blood pressure and diabetes, avoiding harmful exposures, and following kidney trends appropriately.
status: field-testing
quality: usable
aliases:
  - preserve my kidney function
  - slow kidney decline
categories:
  - goals
  - biomarkers
  - kidney-health
goal:
  category: biomarkers
  outcomeKind: function
  goalPhrase: protect my kidney function
  successSignals:
    - id: kidney_function_trend
      kind: biomarker
      label: eGFR and urine albumin remain stable or improve in clinical context
    - id: kidney_protection_actions
      kind: behavior
      label: Blood pressure, diabetes, medication, and kidney-safety actions are sustained
  evidenceSourceKeys:
    - source_artifact:pmid-38490803
    - source_artifact:ada-standards-2026-glycemic-goals
  workflow:
    kind: care_support
    ownerSkillIds:
      - cardiometabolic-health
  startPrompt: Hey Murph, help me protect my kidney function.
  indexable: true
safety:
  cautionLevel: moderate
  stopIf:
    - A major drop in urine, new severe swelling or breathlessness, confusion, or persistent vomiting needs urgent assessment.
---

Protecting kidney function usually means slowing or preventing decline rather than forcing an eGFR number upward. The most effective steps are controlling blood pressure and diabetes, using kidney-protective medicines when indicated, avoiding tobacco and kidney-toxic exposures, and following both filtration and urine albumin over time.

One creatinine-based eGFR can shift with hydration, illness, recent meat intake, supplements, and muscle mass. Chronic kidney disease is defined by persistent abnormalities, not an isolated mildly low result. Urine albumin can reveal kidney damage even when eGFR looks normal, so the two measures complement each other.

## What to do

- **Control blood pressure.** Use accurate home averages and follow the treatment plan. ACE inhibitors or ARBs are particularly important in some people with albuminuria, but dosing and monitoring are clinician-owned.
- **Manage diabetes safely.** Glucose control reduces microvascular damage. SGLT2 inhibitors and other treatments can protect kidneys in eligible people beyond their glucose effect.
- **Avoid routine excess NSAIDs.** Ibuprofen, naproxen, and similar drugs can worsen kidney function in susceptible people, especially during dehydration or when combined with certain medicines. Ask about safer pain options.
- **Do not smoke.** Tobacco damages blood vessels and accelerates cardiovascular and kidney risk.
- **Eat for cardiovascular and kidney health.** Emphasize minimally processed foods and avoid excessive sodium. Protein, potassium, phosphorus, and fluid targets depend on kidney stage; severe restrictions are not automatically helpful.
- **Stay active and address excess weight if relevant.** Activity improves blood pressure, diabetes, function, and cardiovascular risk.
- **Review medicines and supplements.** Dose adjustments may be needed as kidney function changes. Multi-ingredient “detox” or bodybuilding products can be risky or obscure the picture.
- **Plan around illness.** Vomiting, diarrhea, fever, or poor intake can create dehydration and medication risk. Ask for a written sick-day plan rather than guessing which medicines to hold.

## A simple plan

Build a baseline with eGFR trend, urine albumin-to-creatinine ratio, home blood pressure, A1C if relevant, medication list, tobacco, and NSAID use. Ask what stage and cause are suspected, whether results have persisted for at least three months, and when they should be repeated.

For eight weeks, take prescribed treatment consistently, measure blood pressure on a defined schedule, replace frequent high-sodium convenience foods, avoid unplanned NSAID use, and complete regular walking and strength activity at a safe level. If diabetes is present, work on the recurring glucose pattern with the largest impact.

Set reminders for laboratory monitoring required after certain medication starts or dose changes. Keep results in a trend rather than treating each one as a separate event.

## How to know it is working

Stable eGFR over time can be success, especially when decline was expected. A lower or stable urine albumin level, controlled blood pressure, appropriate glucose control, no tobacco, and consistent kidney-protective medication are strong signals. Small eGFR dips can occur after starting certain protective medicines and require clinical interpretation rather than automatic discontinuation.

## What to expect

Kidney protection is a long game. Blood pressure may improve within weeks, urine albumin over months, and eGFR slope across longer follow-up. Some chronic loss cannot be reversed. The aim is to preserve function and reduce kidney failure and cardiovascular risk for as long as possible.

Ask for a clear monitoring cadence rather than ordering extra tests whenever anxiety rises. That schedule may include eGFR, potassium, UACR, blood pressure, and diabetes measures at different intervals. Keep a copy of the trend and current medicine list for urgent visits, where kidney status can change choices about imaging contrast, pain treatment, and dosing.

## If you get stuck

Review measurement conditions, NSAIDs, dehydration, uncontrolled blood pressure or diabetes, missed medication, obstruction, and other causes. Ask whether cystatin C would clarify an uncertain creatinine-based estimate. Rapid decline, heavy albuminuria, blood in urine, resistant hypertension, or unclear cause may warrant nephrology input.

## A quick note

Do not force water, potassium, or protein restriction without a reason. The right kidney plan changes with stage, medicines, and laboratory values. Discuss creatine supplements and very high protein intake if kidney function is impaired or unclear.

## Sources

- [KDIGO: 2024 clinical practice guideline for chronic kidney disease](https://kdigo.org/guidelines/ckd-evaluation-and-management/)
- [American Diabetes Association: 2026 chronic kidney disease and risk management](https://diabetesjournals.org/care/article/49/Supplement_1/S246/163914/11-Chronic-Kidney-Disease-and-Risk-Management)
- [NIDDK: preventing chronic kidney disease](https://www.niddk.nih.gov/health-information/kidney-disease/chronic-kidney-disease-ckd/prevention)

## Related goals

[Reduce Albumin in My Urine](/goals/reduce-urine-albumin) · [Lower My Blood Pressure](/goals/lower-blood-pressure) · [Improve My Blood Sugar Control](/goals/improve-blood-sugar-control)
