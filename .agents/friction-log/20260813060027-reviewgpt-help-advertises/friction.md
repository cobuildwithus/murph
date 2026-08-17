---
title: 'ReviewGPT help advertises unsupported negative artifact flags'
severity: 'minor'
issue: 'cobuildwithus/murph#1808'
---

## What happened

`cobuild-review-gpt --help` advertises `--no-artifacts`, `--no-zip`, and `--no-tests`, but the parser rejects each with `Unknown flag`. The repository wrapper rejects the same flags before the ReviewGPT command runs.

## Expected

The documented negative flags should suppress reattaching an existing repository bundle when continuing an accepted ChatGPT thread.

## Impact

Same-thread continuations must upload a redundant full bundle or bypass the normal command path, increasing latency and context pressure during completion work.

## Workaround

Continue the exact thread through the ordinary wrapper without the negative flags and accept the redundant attachment.
