---
schemaVersion: murph.commons.page.v1
entityType: goal_template
key: goal_template:quit-smoking
slug: quit-smoking
title: Quit Smoking
summary: Make a supported quit attempt using proven treatment, trigger planning, and a fast recovery plan for slips.
status: field-testing
quality: usable
aliases:
  - stop smoking cigarettes
  - become smoke-free
categories:
  - goals
  - mind
  - nicotine
goal:
  category: mind
  outcomeKind: behavior
  goalPhrase: quit smoking
  successSignals:
    - id: smoke_free_days
      kind: behavior
      label: Smoke-free days increase
    - id: treatment_support
      kind: behavior
      label: Evidence-based medication or counseling support is used as chosen
    - id: slip_recovery
      kind: function
      label: A slip leads to a quick return rather than full relapse
  evidenceSourceKeys:
    - source_artifact:va-dod-substance-use-disorder-guideline-2021-08-02
  workflow:
    kind: care_support
    ownerSkillIds:
      - substance-load
      - behavior-followthrough
  startPrompt: Hey Murph, help me quit smoking.
  indexable: true
safety:
  cautionLevel: moderate
---

Quitting smoking is one of the most valuable health changes a person who smokes can make, at any age and after any number of years. Nicotine dependence is a chronic, relapsing condition—not a failure of willpower—and proven treatments make quitting more likely to succeed.

For adults who smoke, counseling and medication each help; using them together gives the best chance of quitting. Options include nicotine replacement therapy and prescription medicines discussed with a clinician. A quit plan should make those options easy to access rather than saving them for after an avoidable crisis.

## What to do

- **Choose support before the quit date.** Contact a quitline, clinician, pharmacist, counselor, or evidence-based program. Decide how often support will check in.
- **Discuss medication.** Nicotine patches, gum, and lozenges are available over the counter in many places; inhaler, nasal spray, varenicline, and bupropion require a prescription in the United States. The right option depends on health, pregnancy, medicines, and preference.
- **Pick a near-term date.** Allow enough time to obtain treatment and change the environment, but not so much that planning replaces action.
- **Map smoking cues.** Common cues include waking, coffee, driving, meals, work breaks, alcohol, stress, and other people smoking.
- **Change the cue-response sequence.** Move coffee, take a different break, clean the car, avoid early alcohol exposure, and keep replacement medication or another response available.
- **Prepare for cravings.** Cravings rise and pass. Delay, use treatment as directed, change location, breathe comfortably, move, or contact support.
- **Plan for slips.** One cigarette is a lapse, not a command to buy a pack. Stop, remove cigarettes, use support, and review the cue that broke the plan.

## A simple plan

Set a quit date within the next two to four weeks. Before it:

1. Choose counseling, quitline, text, or clinical support.
2. Discuss and obtain medication if you want it.
3. Remove cigarettes, lighters, and ashtrays from your regular environments.
4. Tell key people what support helps and what does not.
5. Write a replacement for your five most common cigarettes.

On the quit date, use medication exactly as directed, eat regularly, limit early exposure to strong cues, and keep the schedule simple. Check in with support within the first few days. Withdrawal may include irritability, restlessness, low mood, trouble concentrating, increased appetite, and strong urges; it typically changes over time.

Review at one, two, and four weeks. Track smoke-free days and the situations that were hardest, not every thought about smoking. Adjust treatment with a clinician or pharmacist rather than assuming it “did not work.” Combination nicotine replacement or another medication strategy may be appropriate for some adults.

## How to know it is working

The primary outcome is not smoking. Early secondary signs can include longer gaps between urges, more confidence in cue situations, better taste and smell, less coughing over time, and money saved. Some symptoms fluctuate during withdrawal.

A quit attempt can be valuable even if it includes a lapse. Rapid recovery and continued treatment predict a better path than declaring the attempt over. Many people need more than one attempt.

## If you get stuck

If cravings repeatedly break the plan, contact the quitline or clinician and review medication dose, adherence, cue exposure, and support. If alcohol reliably leads to smoking, reduce or avoid it during the early quit period. If another household member smokes, agree on smoke-free spaces and storage.

Mood and anxiety can shift during quitting. Seek help if symptoms become severe, and tell the prescriber about any concerning medication effects. People who are pregnant, breastfeeding, under 18, or managing significant conditions should use individualized clinical guidance.

## A quick note

Seek urgent help for severe chest pain, trouble breathing, signs of stroke, or thoughts of self-harm. Otherwise, get proven help early: in the United States, 1-800-QUIT-NOW offers free confidential coaching; use your local quit service elsewhere.

## Sources

- [CDC: How to Quit Smoking](https://www.cdc.gov/tobacco/about/how-to-quit.html)
- [CDC: clinical interventions to treat tobacco dependence](https://www.cdc.gov/tobacco/hcp/patient-care-settings/clinical.html)
- [U.S. Preventive Services Task Force: tobacco cessation in adults](https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/tobacco-use-in-adults-and-pregnant-women-counseling-and-interventions)
