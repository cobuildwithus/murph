---
title: 'Hosted-local terminal failure proof omits actionable runner diagnostics'
severity: 'minor'
---

## Expected Behavior

A failed hosted-local setup should report bounded synthetic runner error metadata sufficient to distinguish a transport, container lifecycle, or runtime failure.

## Current Behavior

The scheduled-reminder CI setup can fail on its welcome invocation with only the generic runtime_error status. The failure sanitizer replaces available recent logs with a presence boolean, while the shared stdout/stderr tails can contain only container teardown and unrelated activity completion. Retrying the same source or running the complete suite locally can pass, leaving the first failure's cause unproven.

## Possible Solution

Preserve bounded content-free error code, phase and component metadata for the failing synthetic attempt in the existing harness failure report. Do not expose member payloads or raw production logs.

## Minimal Reproducible Example

Run the existing hosted-local scheduled-reminder predeploy replicas with dev-log streaming disabled. When setup fails after activation and before welcome completion, inspect the generated terminal failure report from waitForHostedCompletion. It can omit the causal runner error even though recent logs are present.

## Context

Observed on two successive rollout candidates. This blocks evidence-based triage and requires a same-source retry. No production change or bypass is proposed.
