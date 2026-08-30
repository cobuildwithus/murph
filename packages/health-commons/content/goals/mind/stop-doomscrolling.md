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

Doomscrolling is repeated, hard-to-stop consumption of distressing news or commentary that leaves you more activated without making you meaningfully better informed. It often begins with a reasonable desire to understand a threat and continues because every new item promises closure that an endless feed cannot provide.

The goal is not ignorance. It is to get reliable information in a bounded way, decide whether action is needed, and then return to your life. A plan should preserve access to important updates while removing the feed’s ability to set the stopping point.

## What to do

- **Choose your information purpose.** Decide whether you need a local safety update, a daily overview, professional detail, or civic information. Different purposes need different sources and frequency.
- **Use finite sources.** A daily newsletter, direct news site, radio bulletin, or saved article has an end. Algorithmic feeds are built to continue.
- **Set check windows.** Choose one or two times that are not immediately after waking or before sleep. Turn an ambient habit into an appointment.
- **Remove feed cues.** Disable breaking-news alerts that are not truly necessary, move apps, log out, or use the browser instead of the app.
- **Name the trigger.** Doomscrolling may follow uncertainty, loneliness, work avoidance, or bedtime. Plan a response for the trigger, not only the content.
- **End with action or closure.** If the information requires action, write it. If not, state what you know and when you will check again.
- **Settle the body afterward.** Stand, look away from the screen, breathe comfortably, walk, or talk with someone. Do not carry the feed directly into sleep or focused work.

## A simple plan

For one week, note when doomscrolling starts, what you were seeking, and how long it lasts. Do not record every article. Identify the dominant window and app.

For the next two weeks, replace that pattern with a bounded news routine:

1. Select two reliable sources.
2. Check them at one scheduled time for no more than 15 or 20 minutes.
3. Write any action or question that follows.
4. Close the source and perform a physical transition.

Remove the feed app from the first screen and disable nonessential alerts. Put a replacement at the old trigger: a downloaded article, book, puzzle, music, short walk, or direct message to someone. If a major event genuinely requires more frequent monitoring, define what signal would change your actions and which official source provides it.

Review after two weeks. Compare unplanned episodes, time lost, sleep timing, and how activated you feel after news use. Keep the information routine that leaves you adequately informed with less spillover.

## How to know it is working

You still know what matters, but check less reflexively, stop closer to the intended time, and return to other activities more easily. The news may remain upsetting; success is that the feed no longer determines how long you stay activated.

Measure unplanned episodes and minutes in the target window, not every encounter with news. Also ask whether you took useful civic or personal action. More information is not automatically more agency.

## If you get stuck

If scheduled checks become long sessions, use a source with a natural endpoint or read offline. If fear of missing an emergency dominates, identify the official alert system that would notify you. If doomscrolling is mainly avoiding another task, use a specific start plan for that task.

During crises, repeated exposure can be especially distressing. Reduce graphic content, take breaks, and speak with people rather than relying entirely on feeds. Persistent anxiety, panic, or sleep disruption may need a broader support plan.

## A quick note

Keep necessary emergency alerts for your location, health, and responsibilities. The aim is to remove low-value repetition and algorithmic escalation, not to disconnect from information that changes what you need to do.

## Sources

- [World Health Organization: mental health and news consumption during emergencies](https://www.who.int/news-room/questions-and-answers/item/stress)
- [BMC Medicine: smartphone screen-time reduction randomized trial](https://doi.org/10.1186/s12916-025-03944-z)
- [PNAS Nexus: blocking mobile internet and psychological functioning](https://doi.org/10.1093/pnasnexus/pgaf017)
