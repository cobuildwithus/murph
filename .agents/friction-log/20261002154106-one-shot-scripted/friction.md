---
title: 'One-shot scripted subagent waits disguise local fixture exhaustion as provider overload'
severity: 'minor'
issue: 'cobuildwithus/murph#3990'
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

## Follow-up Evidence

The bounded wait correction alone did not resolve Linux CI. The full scripted
file passed locally with V8 coverage and the CI worker setting. Separately,
injecting a failed native child shell command reproduced the later failure:
the first unmatched child request lacked the expected read result while parent
wait responses were still available. The resulting local HTTP 500 retries then
exhausted those waits and surfaced as the same generic high-demand error.

The new native shell fixture retained the shared helper's workspace-write mode,
whereas neighboring native shell fixtures and the hosted default explicitly use
danger-full-access. The dedicated Linux permission workflow enables the needed
namespace support; generic coverage CI does not. Align the synthetic delegation
fixture with the hosted default, retaining its read-result and isolation checks.
The Linux sandbox explanation is inferred from these configuration differences;
no native CI trace was retained to prove the exact shell error. Add one bounded,
structural unmatched-request diagnostic so future failures expose matcher and
fixed error-category evidence without raw requests, outputs, or identifiers.
