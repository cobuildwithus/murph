---
title: 'Personal Patterns live fixture omits scheduled delivery contract'
severity: 'minor'
issue: 'cobuildwithus/murph#2980'
---

## Expected Behavior

The live scheduled Pattern journey should assemble the production occurrence context and validate member-visible text through the production notification decision parser.

## Current Behavior

The fixture reused a prompt helper without a scheduled occurrence. That omitted the delivery decision contract, while assertions treated raw provider output as delivered text. Optional vocabulary normalization also had an unconditional two-read assertion despite already-clear labels.

## Minimal Reproducible Example

Run the focused Personal Patterns digest journey with synthetic report data and no scheduledOccurrenceAt in the production system prompt builder. The required notification decision contract is absent. Raw output assertions cannot prove the production delivery shape. Counting command substrings also counts shell commands that never execute after an earlier failed command in an `&&` chain.

## Possible Solution

Supply the synthetic occurrence to the production builder, parse the result with parseAssistantNotificationDecision, and assert decision.text. Start the wording fixture with normalized vocabulary and retain the separate normalization journey. Count actual fixture invocations and require exactly one initial read plus one per vocabulary rewrite, with at most one rewrite.

## Context

This task corrects the affected fixture while verifying notification copy. No production data or transcripts are needed.
