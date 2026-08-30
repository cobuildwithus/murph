---
schemaVersion: murph.commons.page.v1
entityType: goal_template
key: goal_template:reduce-fall-risk
slug: reduce-fall-risk
title: Reduce My Risk of Falling
summary: Lower fall risk through balance and strength training, safer surroundings, and attention to personal risk factors.
status: field-testing
quality: usable
aliases:
  - prevent falls
categories:
  - goals
  - strength
  - balance
goal:
  category: strength
  parentGoalKey: goal_template:improve-balance
  outcomeKind: function
  goalPhrase: reduce my risk of falling
  successSignals:
    - id: fall_prevention_practice
      kind: behavior
      label: Balance and strength work happen regularly
    - id: modifiable_risk_actions
      kind: behavior
      label: Home, vision, footwear, and medication risks are addressed
    - id: safer_daily_mobility
      kind: function
      label: Walking and transfers feel steadier and safer
  evidenceSourceKeys:
    - source_artifact:pmid-36178003
  workflow:
    kind: care_support
    ownerSkillIds:
      - mobility-posture
      - appointment-scheduling
  startPrompt: Hey Murph, help me reduce my risk of falling.
  indexable: true
safety:
  cautionLevel: moderate
---

Fall risk is not one problem. It can reflect leg weakness, balance changes, medications, vision, blood-pressure drops, foot problems, unsafe surroundings, rushing, or a recent illness. Exercise is one of the most consistently supported ways to reduce falls, especially programs that challenge balance and build functional strength, but the strongest plan also addresses the risks that apply to the individual.

Do not wait for a serious fall before acting. A near fall, new fear of walking, or increasing reliance on furniture is useful information. The aim is not to restrict activity. It is to build the ability and environment that make activity safer.

## What to do

- Practice progressively challenging balance and functional strength at least three days per week.
- Train chair rises, step-ups, calf strength, and safe walking.
- Review medicines that can cause dizziness or sedation with a pharmacist or clinician; do not stop them on your own.
- Check vision, footwear, foot comfort, and any new dizziness.
- Remove loose rugs and clutter, improve lighting, and add reliable hand support where needed.
- Use a cane or walker as instructed rather than avoiding it because it feels like a setback.

The most effective exercise programs are usually sustained and challenging enough to improve balance. Casual stretching alone is unlikely to address fall risk. Tai chi, the Otago Exercise Program, supervised group programs, and individualized strength-and-balance training are evidence-based options.

## A simple plan

Start with a safety review of the rooms and routes used most often. Fix one obvious hazard this week. Schedule a medication or vision review if either is overdue or symptoms have changed.

Three days per week, practice beside a counter: two 20-second semi-tandem or tandem holds per side, ten side steps each direction, five step-overs per side, and two sets of five chair rises. Walk on most days at a level that feels steady. Progress balance by using less hand support or a narrower stance—not by moving away from the counter.

If there has been a fall in the past year, repeated near falls, or clear walking difficulty, ask for a fall-risk assessment or physical-therapy referral. Bring a list of circumstances: time, surface, footwear, symptoms, and whether a trip, dizziness, or loss of consciousness occurred.

Make the plan easy to continue. Put balance practice next to an existing daily routine, keep needed support in the same place, and choose an evidence-based class or program if exercising alone is unlikely to happen. A friend or family member can join without turning the work into a test. The best prevention plan is challenging enough to improve capacity and ordinary enough to last.

Revisit hazards after travel, illness, a move, or a medication change. Fall risk changes with context and should not be treated as a permanent personal score.

## How to know it is working

Track completion of the exercise plan, chair-rise performance, balance support, near falls, and confidence on specific tasks. A month with no falls is encouraging but may simply contain fewer risky situations. Improved capacity and fewer near falls provide a better picture.

Review the home checklist and risk-factor actions monthly. Success can include a corrected prescription, a safer bathroom, better footwear, or consistent use of an assistive device—not only a balance-test score.

## If you get stuck

If fear prevents practice, start with supervised sessions and stable support. If dizziness or faintness occurs when standing, record the circumstances and seek evaluation rather than trying to train through it. If feet are numb, vision is limited, or a medicine causes sedation, balance drills alone are incomplete.

Repeated falls require a broader assessment. Ask about gait and balance, blood pressure when changing position, medications, vision, feet, heart rhythm, neurological symptoms, and home safety. The right intervention depends on what is found.

## A quick note

Do not practice challenging balance tasks alone when falling is likely. A fall with a head injury, severe pain, inability to bear weight, loss of consciousness, chest pain, or new neurological symptoms needs urgent help. If you fall and may be injured, call for assistance instead of forcing a floor transfer.

## Sources

- [World guidelines for falls prevention and management](https://pubmed.ncbi.nlm.nih.gov/36178003/)
- [U.S. Preventive Services Task Force evidence review on fall-prevention interventions](https://pubmed.ncbi.nlm.nih.gov/38833257/)
- [CDC STEADI: older-adult fall prevention](https://www.cdc.gov/steadi/index.html)
