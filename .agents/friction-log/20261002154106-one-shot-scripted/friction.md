---
title: 'One-shot scripted subagent waits disguise local fixture exhaustion as provider overload'
severity: 'minor'
---

## Expected Behavior

The credential-free native subagent proof should tolerate a wait timing out before its child completes and then integrate the child result.

## Current Behavior

The fixture queued only one parent wait. A child completion delayed beyond that wait exhausted the matching local responses, causing HTTP 500 retries and a misleading high-demand error. A synthetic twelve-second child delay reproduces the CI failure without contacting a remote provider.

## Possible Solution

Keep a bounded scripted parent wait loop, gate child completion until the parent has waited again, and assert an actual timeout occurred alongside the existing model, context-isolation, tool, and usage checks.

## Minimal Reproducible Example

In the fresh Sol child scripted-runtime test, delay the child's final local response beyond the first ten-second wait. With only one queued parent wait, the next parent request has no matching response.

## Context

Runtime PR CI failed this proof under load although focused local runs passed. This entry records a fixture scheduling defect, not a production provider outage.
