---
schemaVersion: murph.commons.page.v1
entityType: goal_template
key: goal_template:stop-doomscrolling
slug: stop-doomscrolling
title: Stop Doomscrolling
summary: Stay informed without getting trapped in an endless cycle of distressing news, commentary, and algorithmic feeds.
status: field-testing
quality: usable
aliases:
  - stop scrolling bad news
  - doomscroll less
categories:
  - goals
  - mind
  - digital-wellbeing
goal:
  category: mind
  parentGoalKey: goal_template:reduce-screen-time
  outcomeKind: behavior
  goalPhrase: stop doomscrolling
  successSignals:
    - id: scrolling_episodes
      kind: behavior
      label: Fewer unplanned distressing-news scrolling episodes
    - id: planned_news_use
      kind: behavior
      label: News is checked in deliberate windows from chosen sources
    - id: recovery_time
      kind: function
      label: Less time is needed to settle after reading the news
  evidenceSourceKeys:
    - source_artifact:doi-10-17605-osf-io-qps42
    - source_artifact:pmid-30551348
  workflow:
    kind: habit_plan
    ownerSkillIds:
      - cognitive-focus
      - stress-regulation
      - behavior-followthrough
  startPrompt: Hey Murph, help me stop doomscrolling.
  indexable: true
safety:
  cautionLevel: low
---

Doomscrolling is repeated, hard-to-stop consumption of distressing news or commentary that leaves you more activated without making you meaningfully better informed. It often starts as a reasonable wish to understand a threat; the feed then keeps promising a closure it cannot deliver.

The aim is to get reliable information in a bounded way, decide whether anything needs doing, and get back to your life, without losing access to important updates.

## What to do

- **Decide what you need information for.** A local safety update, a daily overview, professional detail, and civic information call for different sources and frequency.
- **Use finite sources.** A daily newsletter, direct news site, radio bulletin, or saved article has an end. Algorithmic feeds do not.
- **Set check windows.** Pick one or two times, not right after waking or right before sleep, and treat them as appointments.
- **Remove feed cues.** Turn off breaking-news alerts you do not truly need, move apps, log out, or use the browser instead of the app.
- **Name the trigger.** Doomscrolling often follows uncertainty, loneliness, work avoidance, or bedtime. Plan a response to the trigger, not just the content.
- **End with action or closure.** If the information calls for action, write it down. If not, state what you know and when you will check again.
- **Settle the body afterward.** Stand up, look away from the screen, breathe comfortably, walk, or talk with someone. Do not carry the feed straight into sleep or focused work.

## A simple plan

For one week, note when doomscrolling starts, what you were looking for, and how long it lasts. Find the dominant window and app.

For the next two weeks, replace that pattern with a bounded news routine:

1. Pick one or two reliable sources.
2. Check them in one scheduled window. Fifteen to 20 minutes is a starting example, not a required limit.
3. Write down any action or question that follows.
4. Close the source and do a physical transition.

Take the feed app off the first screen and turn off nonessential alerts. Put a replacement at the old trigger: a downloaded article, a book, a puzzle, music, a short walk, or a direct message to someone. If a major event genuinely needs closer monitoring, define what signal would change your actions and which official source provides it.

Review after two weeks. Compare unplanned episodes, time lost, sleep timing, and how activated you feel after news. Keep the routine that leaves you adequately informed with less spillover.

## How to know it is working

You still know what matters, but you check less reflexively, stop closer to the intended time, and get back to other things more easily. The news may still be upsetting. Success is that the feed no longer decides how long you stay activated.

Measure unplanned episodes and minutes in the target window, not every encounter with news. Ask, too, whether you took useful civic or personal action.

## If you get stuck

If scheduled checks stretch into long sessions, use a source with a natural endpoint or read offline. If fear of missing an emergency is the driver, find the official alert system that would notify you. If doomscrolling is mostly a way to avoid another task, make a specific start plan for that task.

During crises, repeated exposure can be especially distressing. Cut graphic content, take breaks, and talk with people instead of relying entirely on feeds. Persistent anxiety, panic, or sleep disruption may need a broader support plan.

## A quick note

Keep the emergency alerts you need for your location, health, and responsibilities. The aim is to remove low-value repetition and algorithmic escalation, not to cut yourself off from information that changes what you need to do.

## Sources

- [World Health Organization: mental health and news consumption during emergencies](https://www.who.int/news-room/questions-and-answers/item/stress)
- [BMC Medicine: smartphone screen-time reduction randomized trial](https://doi.org/10.1186/s12916-025-03944-z)
- [PNAS Nexus: blocking mobile internet and psychological functioning](https://doi.org/10.1093/pnasnexus/pgaf017)
