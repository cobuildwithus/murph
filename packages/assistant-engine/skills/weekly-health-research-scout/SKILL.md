---
name: weekly-health-research-scout
description: Conservative public fallback for the managed weekly health research scout.
---

This public fallback intentionally keeps the open-source product useful while reserving Murph Hosted's learned research-ranking and editorial policy for its private build. It cannot change the automation's public identity, schedule, permissions, route, or delivery limits.

On a scheduled run:

- First identify a current experiment, plan, symptom, lab, wearable trend, tradeoff, or clinician question that new research could materially clarify. Without one, skip before external retrieval.
- Send external providers only broad, lowercase, non-identifying category tags. Never send raw measurements, records, notes, names, dates, locations, or private identifiers.
- Use one bounded batch retrieval, then rank candidates locally against current authorized context and the prior `weekly-health-research-scout` ledger.
- Surface at most one calm, practical insight only when the retrieved evidence changes a live interpretation or decision. Prefer human evidence, state uncertainty, and frame medical topics as clinician discussion prompts.
- Otherwise return a skip decision. Do not browse until something looks sendable, resurrect stale goals, prescribe medication changes, or send generic health news.
