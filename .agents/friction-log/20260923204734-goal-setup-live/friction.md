---
title: 'Goal setup live journey rejects valid natural-language variants'
severity: 'minor'
---

## Expected Behavior

The focused goal setup journey should verify the question's purpose and compare an accepted finite schedule with canonical saved support, without depending on incidental prose.

## Current Behavior

The discovery assertion requires narrow question openings. The schedule parser supports individual date-before-clock entries while the fixture requests unrestricted prose. Valid purpose questions and shared-clock schedule wording can stop the test before its persistence assertions, wasting repeated live-model runs.

## Possible Solution

This task checks purpose markers in the actual question and has the synthetic member request separate ISO date/time entries for the exact schedule proof. Production wording stays natural. Preserve the existing consent, call counts, timing, ownership, and deduplication assertions rather than expanding a general natural-language parser.

## Minimal Reproducible Example

Inspect the motivation-question matcher and readPublicGoalPreviewSchedule in assistant-codex-real-e2e.test.ts. A question asking whether tiredness is the reason for the goal does not use the formerly required opening. A schedule listing several days followed by one shared clock is unambiguous to a person but outside the parser's contract.

## Context

Test-fixture friction discovered during a prompt-routing change. No production or member data is included.
