---
description: One-pass seam audit prompt for the apps/cloudflare user-runner seam
---

# `apps/cloudflare` User Runner

## Scope

- `apps/cloudflare/src/{user-runner.ts,user-runner/**,index.ts,web-control-plane.ts}`
- `apps/cloudflare/test/{index,runner-platform,runner-outbound}.test.ts`
- directly coupled `apps/cloudflare/test/**`

## Focus

- hosted workspace nudge flow, retained device-sync system-mailbox wakes, timer wake persistence, and runtime callback fencing
- retry, replay, poison, and resume behavior around hosted workspace-runtime work
- Durable Object coordination staying non-authoritative relative to web-owned hosted-runtime state

## Prompt

Review the `apps/cloudflare` user-runner seam using the scope above. Focus on concrete bugs in the hosted workspace nudge flow, runtime callback ordering, timer wake handling, and any retry or replay path that could duplicate side effects or desync from web-owned hosted-runtime truth. Return only evidence-backed findings from current code, prioritizing concrete regressions and behavior-preserving simplification targets that keep the user-runner coordination logic smaller and less stateful. For each finding include `severity`, `file:line`, `issue`, `impact`, and `recommended fix`; list risk findings first, then simplification findings, and say explicitly if a category has no findings.
