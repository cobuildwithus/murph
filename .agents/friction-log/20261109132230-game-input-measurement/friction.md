---
title: 'Game input measurement adds the private reminder line only to the direct head capture'
severity: 'minor'
---

## Expected Behavior

`packages/assistant-engine/test/assistant-game-input-measurement.test.ts` builds the direct-chat base and head provider requests from the same inputs, so its byte delta reflects only the change under review.

## Current Behavior

For the direct fixture, the head phase appends `GAME_PRIVATE_REMINDER_DIRECT_GUIDANCE` to the developer instructions and the base phase does not (`scope === 'direct' && phase === 'head'`). That guidance shipped earlier, so every later run reports a fixed direct delta of about +52 bytes (the "For game reminders, use murph.my_game_reminders." line), even for a change that does not touch direct chats. Reviewers have to diff the captures by hand to see that the delta is not theirs.

## Possible Solution

Include the reminder guidance in both phases when the base already contains it (or derive it from the base module the way the tool catalog is), so the default base and later bases measure like for like.

## Minimal Reproducible Example

1. On any branch that changes only group game tool text, run the measurement with `MURPH_MEASURE_GAME_INPUT=1 MURPH_VERIFY_GAME_SKEW=1 MURPH_GAME_INPUT_BASE=<merge-base>`.
2. The direct fixture reports a non-zero delta.
3. Write captures with `MURPH_GAME_INPUT_OUTPUT_DIRECTORY` and diff direct base vs head after normalizing IDs: the only content difference is the reminder line.

## Context

Found while measuring initial provider input for a game call-off change. The PR body requires accurate absolute and delta measurements; the fixed offset makes the direct number misleading.
