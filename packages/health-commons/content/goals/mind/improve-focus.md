---
schemaVersion: murph.commons.page.v1
entityType: goal_template
key: goal_template:improve-focus
slug: improve-focus
title: Improve My Focus
summary: Make sustained attention easier by reducing interruption, clarifying the next task, and protecting the basics that attention depends on.
status: field-testing
quality: usable
aliases:
  - focus better
  - improve concentration
categories:
  - goals
  - mind
  - focus
goal:
  category: mind
  outcomeKind: function
  goalPhrase: improve my focus
  successSignals:
    - id: focused_blocks
      kind: behavior
      label: More planned focus blocks completed
    - id: task_return
      kind: function
      label: Faster return to the task after an interruption
    - id: meaningful_output
      kind: function
      label: More important work completed with less scattered effort
  evidenceSourceKeys:
    - source_artifact:doi-10-1016-j-abrep-2021-100365
    - source_artifact:pmid-32040492
  workflow:
    kind: habit_plan
    ownerSkillIds:
      - cognitive-focus
      - behavior-followthrough
  startPrompt: Hey Murph, help me improve my focus.
  indexable: true
safety:
  cautionLevel: low
---

Focus comes from attention, energy, a clear task, and a workable environment. You can rarely force concentration for hours, but you can make the next important task easier to start and cheaper to return to after an interruption.

Aim at a specific situation you can design and measure: writing for 30 minutes, reading without checking your phone, staying present in meetings, or finishing admin work.

## What to do

- **Define one visible outcome.** "Work on the report" is vague; "draft the opening and first chart" says what done looks like.
- **Make the first action tiny.** Open the source document, write the question, or read the first paragraph. Trouble starting often looks like poor concentration.
- **Remove active invitations.** Silence nonessential notifications, close unrelated tabs, and put the phone out of reach for the block.
- **Work in bounded blocks.** Pick a length you can finish, perhaps 20 to 45 minutes, then take a real break. There's no best timer; the right block makes progress and is short enough to repeat.
- **Keep an interruption pad.** Write down unrelated tasks and ideas instead of switching to them, and sort them at the end of the block.
- **Protect the physiology.** Short sleep, missed meals, pain, anxiety, alcohol after-effects, and too much or badly timed caffeine all impair concentration. Fix the biggest one first.
- **Match work to energy.** Do the task that needs the most reasoning when you're reliably alert. Save routine decisions and communication for lower-energy periods.

Research suggests that cutting constant smartphone internet or screen access can improve sustained attention for some people. Extreme disconnection is unnecessary and hard to keep up; protected periods are the useful move.

## A simple plan

Choose one important task and one repeatable time, and run a two-week practice. Before each block, write the single output, clear the workspace, put the phone away, and set the block length. Keep a paper or plain-text note for interruptions.

Afterward, record minutes planned, minutes completed, whether the output got finished, and the number of unplanned switches. If the block failed, label why: unclear task, external interruption, fatigue, worry, or phone.

After the first week, fix only the largest source of failure. Unclear task: define the next action the night before. Messages: agree an availability window with colleagues. Fatigue: move the block earlier or deal with sleep. Phone: put it in another room instead of relying on an app limit you dismiss.

In week two, practice returning after an interruption. Skip the self-judgment, look at the output statement, take one breath, and do the next visible action. Focus is partly the skill of returning.

## How to know it is working

Measure output and repeatable blocks, not how concentrated you felt. Good signs are more completed blocks, fewer unplanned switches, quicker returns, and less time spent getting ready to begin.

Focus varies with sleep, stress, interest, and task difficulty, so compare similar tasks at similar times. A 30-minute block that reliably works beats two depleted hours forced now and then.

## If you get stuck

If you avoid only one task, the problem is probably ambiguity, fear of being judged, a missing skill, or disagreement with the work, not focus in general. Write down the open question or ask for clarification. If every task is hard, review sleep, mood, anxiety, substances, medication, vision, hearing, and workload.

Concentration problems that started suddenly, follow a head injury, are getting worse, or substantially impair daily life need medical attention. Long-standing attention difficulties are worth discussing with a qualified clinician rather than self-diagnosing from a productivity pattern.

## A quick note

More focus is not always better. Sustained work needs breaks, movement, meals, and responsiveness to the people around you. Build a reliable block, then stop. Don't turn attention into another all-day surveillance metric.

## Sources

- [PNAS Nexus: blocking mobile internet improved sustained attention in a randomized trial](https://doi.org/10.1093/pnasnexus/pgaf017)
- [BMC Medicine: smartphone screen-time reduction randomized trial](https://doi.org/10.1186/s12916-025-03944-z)
- [CDC: sleep and sleep disorders](https://www.cdc.gov/sleep/about/index.html)
