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

Fall risk isn't one problem. Leg weakness, balance changes, medications, vision, blood-pressure drops, foot problems, unsafe surroundings, rushing, or a recent illness can all play a part. Exercise is one of the most consistently supported ways to reduce falls, especially programs that challenge balance and build functional strength, but the strongest plan also tackles the risks that apply to you.

Don't wait for a serious fall. A near fall, a new fear of walking, or leaning on furniture more often is useful information. Don't respond by restricting activity; build the ability and surroundings that make activity safer.

## What to do

- Practice progressively harder balance and functional strength at least three days a week.
- Train chair rises, step-ups, calf strength, and safe walking.
- Have a pharmacist or clinician review medicines that can cause dizziness or sedation; don't stop them on your own.
- Check vision, footwear, foot comfort, and any new dizziness.
- Remove loose rugs and clutter, improve lighting, and add reliable hand support where needed.
- Use a cane or walker as instructed, even if it feels like a setback.

The programs that work are sustained and hard enough to improve balance; casual stretching alone is unlikely to change fall risk. Tai chi, the Otago Exercise Program, supervised group programs, and individualized strength-and-balance training all have evidence behind them.

## A simple plan

Start with a safety review of the rooms and routes you use most, and fix one obvious hazard this week. Book a medication or vision review if either is overdue or symptoms have changed.

Three days a week, practice beside a counter: two 20-second semi-tandem or tandem holds per side, ten side steps in each direction, five step-overs per side, and two sets of five chair rises. Walk most days at a pace that feels steady. Progress by using less hand support or a narrower stance, not by moving away from the counter.

After a fall in the past year, repeated near falls, or clear walking difficulty, ask for a fall-risk assessment or a physical-therapy referral. Bring the circumstances: time, surface, footwear, symptoms, and whether a trip, dizziness, or loss of consciousness was involved.

Make the plan easy to keep. Attach balance practice to an existing daily routine, keep any support you need in the same place, and pick an evidence-based class or program if exercising alone won't happen. A friend or family member can join without turning it into a test.

Recheck hazards after travel, illness, a move, or a medication change. Fall risk shifts with context; it isn't a permanent personal score.

## How to know it is working

Track plan completion, chair-rise performance, how much balance support you need, near falls, and confidence on specific tasks. A month with no falls is encouraging but may just have held fewer risky situations. Better capacity and fewer near falls tell you more.

Review the home checklist and risk-factor actions monthly. Success can be a corrected prescription, a safer bathroom, better footwear, or consistent use of an assistive device, not only a balance-test score.

## If you get stuck

If fear stops you practicing, start with supervised sessions and stable support. If you get dizzy or faint on standing, note the circumstances and get evaluated rather than training through it. If your feet are numb, your vision is limited, or a medicine sedates you, balance drills alone aren't enough.

Repeated falls need a broader assessment covering gait and balance, blood pressure when changing position, medications, vision, feet, heart rhythm, neurological symptoms, and home safety. The right intervention depends on what turns up.

## A quick note

Don't practice challenging balance tasks alone when a fall is likely. A fall with a head injury, severe pain, inability to bear weight, loss of consciousness, chest pain, or new neurological symptoms needs urgent help. If you fall and may be hurt, call for help instead of forcing yourself up off the floor.

## Sources

- [World guidelines for falls prevention and management](https://pubmed.ncbi.nlm.nih.gov/36178003/)
- [U.S. Preventive Services Task Force evidence review on fall-prevention interventions](https://pubmed.ncbi.nlm.nih.gov/38833257/)
- [CDC STEADI: older-adult fall prevention](https://www.cdc.gov/steadi/index.html)
