---
schemaVersion: murph.commons.page.v1
entityType: goal_template
key: goal_template:reduce-fracture-risk
slug: reduce-fracture-risk
title: Lower My Risk of Fractures
summary: Reduce fractures by treating fragile bone, building strength and balance, and removing the fall risks most relevant to you.
status: field-testing
quality: usable
aliases:
  - prevent broken bones
  - reduce osteoporosis fracture risk
categories:
  - goals
  - biomarkers
  - bone-health
goal:
  category: biomarkers
  parentGoalKey: goal_template:build-stronger-bones
  outcomeKind: function
  goalPhrase: lower my risk of fractures
  successSignals:
    - id: fracture_prevention_plan
      kind: behavior
      label: Bone treatment, strength, balance, and fall-prevention actions are sustained
    - id: fall_risk_function
      kind: function
      label: Strength, balance, vision, and home safety improve
    - id: fracture_free
      kind: milestone
      label: No new fragility fractures occur
  evidenceSourceKeys:
    - source_artifact:pmid-35478046
    - source_artifact:pmid-40921943
  workflow:
    kind: care_support
    ownerSkillIds:
      - strength-training
      - micronutrients-supplements
  startPrompt: Hey Murph, help me lower my risk of fractures.
  indexable: true
safety:
  cautionLevel: moderate
  stopIf:
    - New severe pain, inability to bear weight after a fall, or sudden back pain with height loss needs prompt assessment.
---

Fractures happen when bone strength and the force of a fall or impact meet. That means prevention has two equally important sides: strengthen and treat the skeleton, and reduce the chance or severity of falls. A DXA scan helps estimate bone density, but age, prior fractures, steroid exposure, falls, family history, and other conditions can matter just as much.

A prior hip or vertebral fragility fracture is a major warning even if a bone-density report is not in the osteoporosis range. In people at high risk, medication is often the most powerful way to reduce fracture probability. Exercise, calcium, vitamin D, and home safety support that treatment rather than replace it.

## What to do

- **Get screened when appropriate.** Current U.S. guidance recommends osteoporosis screening for women 65 and older and for younger postmenopausal women at increased risk. Other people may need evaluation based on fractures, steroids, low weight, or medical conditions.
- **Treat osteoporosis when benefit is meaningful.** Bisphosphonates, denosumab, bone-building medicines, and other options fit different risk levels. Administration, duration, and transitions matter; some medicines should not be stopped without a follow-on plan.
- **Strength train.** Focus on legs, hips, back, and grip two or three times weekly. Stronger muscles improve both loading and the ability to catch or control a stumble.
- **Practice balance.** Tai chi, single-leg work near support, step drills, and physical therapy can reduce fall risk when progressed appropriately.
- **Make the home easier to navigate.** Improve lighting, secure loose rugs and cords, add stair rails or grab bars where needed, and keep frequently used items accessible.
- **Review vision, feet, and medicines.** Poor vision, neuropathy, sedatives, blood-pressure drops, and inappropriate footwear are common modifiable risks.
- **Meet calcium, vitamin D, protein, and energy needs.** Correct deficiencies without megadosing. Muscle loss from under-eating can increase falls even when the diet seems “clean.”
- **Avoid smoking and heavy alcohol.** Both affect bone; alcohol and sedating substances also increase falls.

## A simple plan

Build a risk snapshot: prior fractures and falls, DXA and fracture-risk estimate if available, medicines including steroids and sedatives, vision, balance, footwear, home hazards, calcium and protein intake, vitamin D status when relevant, and current bone medication.

For 12 weeks, do two supervised or well-designed strength sessions, three five-minute balance sessions, and one home-safety pass. Book overdue vision or medication review. Make prescribed osteoporosis treatment and calcium-rich foods part of stable routines.

If you fall, log where, why, footwear, dizziness, and injury. The point is to find a pattern, not to blame yourself.

## How to know it is working

The ultimate signal is remaining free of fragility fractures. Nearer-term signs include fewer falls or near-falls, better chair-rise and stair ability, longer controlled balance, stronger lifts, corrected vision or medication issues, and consistent bone treatment. DXA is repeated only at intervals that can show meaningful change; stable density may be success.

## What to expect

Balance and strength can improve within weeks, while fracture reduction from bone treatment and remodeling develops over months. Risk never becomes zero. A person can fracture with a “better” DXA, and someone with low density may avoid fractures through treatment and fall prevention.

Reassess after any fall, not only after a fracture. A near-fall may expose an unsafe step, a nighttime bathroom route, new dizziness, or declining foot sensation while there is still time to act. Also revisit the plan after a new sedating medicine, vision change, hospitalization, or long period of inactivity. Fracture risk is dynamic, so a once-completed checklist is less useful than a small review after meaningful changes.

## If you get stuck

If fear of falling is reducing activity, ask for physical therapy rather than becoming less mobile. Review dizziness on standing, neuropathy, hearing, vision, sedatives, alcohol, urgency at night, and home layout. If bone density worsens despite treatment, check adherence, administration, malabsorption, and secondary causes before assuming the medicine failed.

## A quick note

After a fragility fracture, ask about coordinated fracture-liaison care so the cause and prevention plan do not get lost after the acute injury. Do not discontinue denosumab or another osteoporosis medicine without a clinician-directed transition.

## Sources

- [USPSTF: 2025 osteoporosis screening recommendation](https://www.uspreventiveservicestaskforce.org/uspstf/document/final-recommendation-statement/osteoporosis-screening)
- [NIAMS: osteoporosis diagnosis and treatment](https://www.niams.nih.gov/health-topics/osteoporosis/diagnosis-treatment-and-steps-to-take)
- [CDC: older adult fall prevention](https://www.cdc.gov/falls/prevention/index.html)

## Related goals

[Build Stronger Bones](/goals/build-stronger-bones) · [Correct My Vitamin D Deficiency](/goals/correct-vitamin-d-deficiency)
