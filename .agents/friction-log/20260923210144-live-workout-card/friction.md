---
title: 'Live workout card fixtures omit canonical vault root'
severity: 'minor'
---

## Expected Behavior

Synthetic live workout journeys that initialize a canonical vault should provide that same vault to the response-card editor so card behavior can be evaluated.

## Current Behavior

Existing planned-workout and set-completion journeys pass the working directory but omit the explicit vault root required by the dynamic workout-card editor. The editor reports WORKOUT_CARD_EDITOR_UNAVAILABLE with a missing-vault classification. These failures reproduce on the unchanged base and block a clean live regression comparison independently of prompt edits.

## Possible Solution

Pass the initialized fixture vault through the existing turn input in affected journeys. Add a cheap fixture-boundary assertion so missing owner context is caught before real-model calls.

## Minimal Reproducible Example

Run `pnpm test:assistant:live -- --test "starts one exact ad-hoc planned workout without logging its sets" --model gpt-6-sol` with an available local subscription. Inspect the fixture turn input and the workout editor owner in `packages/assistant-engine/src/assistant-codex/dynamic-tools.ts`.

## Context

Discovered while comparing the full synthetic real-Codex suite against an unchanged base for a system-prompt change. No production data or member delivery is involved.
