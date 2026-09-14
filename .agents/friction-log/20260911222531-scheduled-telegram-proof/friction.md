---
title: 'Scheduled Telegram proof retained a retired automation tool payload'
severity: 'minor'
---

The registered scheduled Telegram journey should execute in integration CI and use the current model-facing automation tool contract. Its setup acknowledgement must be followed by a saved future wake and actual direct/group scheduled sends.

## Current Behavior

The journey was not selected by the private full-integration manifest. Its scripted direct-reminder save therefore retained the retired raw ISO `schedule.at` payload after the tool switched to `schedule.localAt`. Selecting the journey exposed a failure to arm the reminder, despite the scripted setup acknowledgement being sent.

## Possible Solution

Repair the fixture to pass a local date, minute, and timezone and align its due-time observer with that minute. Preserve the real scheduled-send assertions. Select the dedicated journey and require it separately from the first-contact Telegram alias. Land the fixture first because full integration intentionally tests public main.

## Minimal Reproducible Example

Replay the actual fixture's generated automation arguments through the production tool parser. The original raw-ISO payload is rejected; the repaired localAt payload is accepted. Then execute `telegram-scheduled-reminder` through the full hosted harness and require the future wake plus direct/group provider sends without manual wake nudges.

## Context

The isolated fixture correction is PR #3357. PR #3350 adds the public selection requirement after its private selecting consumer passes. A scenario registry entry and a scripted acknowledgement alone do not prove that CI executes a functioning scheduled-delivery journey. This report uses synthetic fixture behavior and contains no production records.
