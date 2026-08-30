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

Fatty liver disease linked to metabolic dysfunction is now commonly called MASLD. The useful outcome is not simply a lower liver enzyme on one test. It is less liver fat, lower inflammation and fibrosis risk, and better control of the diabetes, weight, lipids, blood pressure, and alcohol exposure that shape long-term liver and cardiovascular health.

Most people with early MASLD can improve it substantially. The first clinical priority is to identify who may already have significant fibrosis, because fibrosis—not the amount of fat alone—is the strongest liver-related risk marker. Simple blood-based scores and elastography can help; a normal ALT does not reliably rule fibrosis out.

## What to do

- **Pursue sustainable weight loss if excess weight is a driver.** Even modest loss can reduce liver fat, while larger maintained losses are more likely to improve inflammation and fibrosis. The appropriate amount and method are individual.
- **Choose a durable food pattern.** A Mediterranean-style pattern rich in vegetables, legumes, whole grains, fish, nuts, and unsaturated oils is a sound default. Reduce sugary drinks, excess refined carbohydrate, and repeated ultra-processed foods.
- **Move every week.** Aerobic and resistance exercise can reduce liver fat even without major weight loss. Start from your capacity and build toward regular moderate activity plus two strength sessions.
- **Address alcohol honestly.** MASLD can coexist with alcohol-related injury. The safest amount depends on liver status and other risk; advanced fibrosis or cirrhosis usually warrants abstinence.
- **Treat diabetes, lipids, and blood pressure.** Cardiovascular disease is a major risk for people with MASLD. Evidence-based metabolic treatment is part of liver care, not a distraction from it.
- **Review medicines and other liver causes.** Viral hepatitis, autoimmune disease, iron overload, and some medicines can produce or worsen abnormal liver findings. Do not assume all liver fat or enzyme elevation has one cause.
- **Use disease-directed care when eligible.** Selected people with more advanced inflammatory disease may qualify for medication or specialist care. Treatment depends on confirmed stage and current approvals.

## A simple plan

Start with the diagnosis and risk stage you actually have: imaging, ALT and AST, platelet count, diabetes status, lipids, blood pressure, alcohol pattern, weight trajectory, and any fibrosis score or elastography. Ask whether hepatology follow-up is needed.

For 12 weeks, choose a repeatable plan: replace sugary drinks, prepare two plant-forward dinners weekly, walk briskly for 30 minutes on five days, and strength train twice. If weight loss is appropriate, aim for a steady trend rather than a crash. Set a clear alcohol boundary.

Schedule reassessment around the marker that can answer the question—metabolic labs and weight sooner, liver imaging or fibrosis assessment at a clinically meaningful interval.

## How to know it is working

Useful signals include a sustained reduction in weight or waist when appropriate, better glucose and triglycerides, improved fitness, lower liver fat on comparable imaging, and improving ALT or AST in context. Fibrosis measures change more slowly and can be noisy. A lower enzyme value is encouraging but does not prove the disease or fibrosis is gone.

## What to expect

Liver fat can fall within weeks of an effective energy deficit and regular activity. Inflammation and fibrosis take longer. People respond differently, and the plan must be maintained to preserve gains. Even if liver markers change modestly, improvements in blood pressure, diabetes, fitness, and ApoB can substantially lower the cardiovascular risk that accompanies MASLD.

## If you get stuck

Check liquid calories, alcohol, weekend patterns, sleep apnea, medication adherence, and whether the plan is too restrictive. If enzymes remain elevated, ask whether another liver condition has been excluded. A dietitian, obesity-medicine clinician, diabetes clinician, or hepatologist can help when meaningful weight loss or fibrosis risk requires more than self-directed habits.

## A quick note

Do not use “liver detox” products. Some supplements can injure the liver, and product contents may be uncertain. Advanced fibrosis, cirrhosis, pregnancy, or rapidly changing liver tests needs an individualized clinical plan.

## Sources

- [AASLD: clinical assessment and management of MASLD](https://www.aasld.org/practice-guidelines/clinical-assessment-and-management-metabolic-dysfunction-associated-steatotic)
- [American Diabetes Association: 2026 comprehensive medical evaluation and MASLD assessment](https://diabetesjournals.org/care/article/49/Supplement_1/S61/163931/4-Comprehensive-Medical-Evaluation-and-Assessment)
- [NIDDK: metabolic dysfunction-associated steatotic liver disease](https://www.niddk.nih.gov/health-information/liver-disease/nafld-nash)

## Related goals

[Reduce My Liver Fat](/goals/reduce-liver-fat) · [Improve My Blood Sugar Control](/goals/improve-blood-sugar-control) · [Lower My Triglycerides](/goals/lower-triglycerides)

