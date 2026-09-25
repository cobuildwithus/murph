---
title: 'Journal live fixtures contradict automation capability and fabricate CLI success'
severity: 'minor'
---

## Expected Behavior

Journal model journeys should declare the capabilities their hosted tool ports expose and prove canonical effects through the actual CLI.

## Current Behavior

The calendar and email journeys provide the automation tool but build system instructions with hosted automation availability disabled. The Journal shell fixture also returns an event-shaped success for help, reads, invalid flags, and nonexistent commands. Missing follow-ups therefore cannot distinguish model behavior from contradictory test instructions, and accepted command strings do not establish saved notes.

## Possible Solution

Set the existing prompt capability from the fixture port, reuse the canonical CLI wrapper, and assert actual notes, ledger pages, and linked automation records. Check help and rejected commands without a model first.

## Minimal Reproducible Example

Build the Journal calendar fixture instructions and compare scheduled automation availability with its dynamic tools. Run its old CLI with a nonexistent command: it returns success rather than rejecting the command.

## Context

Found while validating a scheduled model change. Correcting the fixture is necessary before attributing a failed journey to the model or changing production architecture.
