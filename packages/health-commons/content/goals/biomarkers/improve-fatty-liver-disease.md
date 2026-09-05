---
schemaVersion: murph.commons.page.v1
entityType: goal_template
key: goal_template:improve-fatty-liver-disease
slug: improve-fatty-liver-disease
title: Improve Fatty Liver Disease
summary: Improve metabolic fatty liver disease by reducing liver fat, treating metabolic risks, and following fibrosis with the right clinical tools.
status: field-testing
quality: usable
aliases:
  - improve MASLD
  - improve fatty liver
categories:
  - goals
  - biomarkers
  - liver-health
goal:
  category: biomarkers
  outcomeKind: biomarker
  goalPhrase: improve fatty liver disease
  successSignals:
    - id: liver_disease_markers
      kind: biomarker
      label: Liver fat, enzymes, or fibrosis assessment improves in clinical context
    - id: masld_treatment_actions
      kind: behavior
      label: Weight, activity, food, alcohol, and metabolic treatment actions are sustained
  evidenceSourceKeys:
    - source_artifact:pmid-36930148
    - source_artifact:pmid-40020647
  workflow:
    kind: care_support
    ownerSkillIds:
      - cardiometabolic-health
  startPrompt: Hey Murph, help me improve fatty liver disease.
  indexable: true
safety:
  cautionLevel: moderate
  stopIf:
    - Yellow skin or eyes, vomiting blood, black stool, new abdominal swelling, or confusion needs urgent medical care.
---

Fatty liver disease linked to metabolic dysfunction is now usually called MASLD. The outcome worth chasing is less liver fat, lower inflammation and fibrosis risk, and better control of the diabetes, weight, lipids, blood pressure, and alcohol exposure that shape long-term liver and heart health. A lower enzyme on one test is a small part of that.

Most people with early MASLD can improve it substantially. The first clinical priority is finding out who already has significant fibrosis, because fibrosis, more than the amount of fat, is the strongest liver-related risk marker. Simple blood-based scores and elastography can help. A normal ALT does not reliably rule fibrosis out.

## What to do

- **Lose weight at a pace you can keep if excess weight is a driver.** Even modest loss can reduce liver fat; larger, maintained losses are more likely to improve inflammation and fibrosis. The right amount and method are individual.
- **Pick a food pattern you can stay on.** A Mediterranean-style pattern rich in vegetables, legumes, whole grains, fish, nuts, and unsaturated oils is a sound default. Cut sugary drinks, excess refined carbohydrate, and the ultra-processed foods you eat on repeat.
- **Move every week.** Aerobic and resistance exercise can reduce liver fat even without major weight loss. Start where you are and build toward regular moderate activity plus two strength sessions.
- **Be honest about alcohol.** MASLD can coexist with alcohol-related injury. The safest amount depends on liver status and other risks; advanced fibrosis or cirrhosis usually calls for abstinence.
- **Treat diabetes, lipids, and blood pressure.** Cardiovascular disease is a major risk for people with MASLD. Evidence-based metabolic treatment is part of liver care.
- **Review medicines and other liver causes.** Viral hepatitis, autoimmune disease, iron overload, and some medicines can cause or worsen abnormal liver findings. Don’t assume all the fat or enzyme elevation has one cause.
- **Use disease-directed care when eligible.** Some people with more advanced inflammatory disease qualify for medication or specialist care, depending on confirmed stage and current approvals.

## A simple plan

Start from the diagnosis and risk stage you actually have: imaging, ALT and AST, platelet count, diabetes status, lipids, blood pressure, alcohol pattern, weight trend, and any fibrosis score or elastography. Ask whether you need hepatology follow-up.

For 12 weeks, run a plan you can repeat: replace sugary drinks, cook two plant-forward dinners a week, walk briskly for 30 minutes on five days, and strength train twice. If weight loss is appropriate, aim for a steady trend, not a crash. Set a clear alcohol limit.

Schedule reassessment around the marker that can answer the question: metabolic labs and weight sooner, liver imaging or fibrosis assessment at a clinically meaningful interval.

## How to know it is working

Useful signals: a sustained drop in weight or waist when appropriate, better glucose and triglycerides, improved fitness, lower liver fat on comparable imaging, and improving ALT or AST in context. Fibrosis measures move more slowly and can be noisy. A lower enzyme value is encouraging but does not prove the disease or fibrosis is gone.

## What to expect

Liver fat can fall within weeks of an effective energy deficit and regular activity. Inflammation and fibrosis take longer. People respond differently, and you keep the gains only as long as you keep the plan. Even if liver markers change modestly, better blood pressure, diabetes control, fitness, and ApoB can substantially lower the cardiovascular risk that comes with MASLD.

## If you get stuck

Check liquid calories, alcohol, weekend patterns, sleep apnea, medication adherence, and whether the plan is too restrictive. If enzymes stay elevated, ask whether another liver condition has been ruled out. When meaningful weight loss or fibrosis risk needs more than self-directed habits, a dietitian, obesity-medicine clinician, diabetes clinician, or hepatologist can help.

## A quick note

Don’t use “liver detox” products. Some supplements can injure the liver, and product contents may be uncertain. Advanced fibrosis, cirrhosis, pregnancy, or rapidly changing liver tests need an individualized clinical plan.

## Sources

- [AASLD: clinical assessment and management of MASLD](https://www.aasld.org/practice-guidelines/clinical-assessment-and-management-metabolic-dysfunction-associated-steatotic)
- [American Diabetes Association: 2026 comprehensive medical evaluation and MASLD assessment](https://diabetesjournals.org/care/article/49/Supplement_1/S61/163931/4-Comprehensive-Medical-Evaluation-and-Assessment)
- [NIDDK: metabolic dysfunction-associated steatotic liver disease](https://www.niddk.nih.gov/health-information/liver-disease/nafld-nash)

## Related goals

[Reduce My Liver Fat](/goals/reduce-liver-fat) · [Improve My Blood Sugar Control](/goals/improve-blood-sugar-control) · [Lower My Triglycerides](/goals/lower-triglycerides)
