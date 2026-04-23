---
description: One-pass seam audit prompt for the apps/cloudflare user-runner seam
---

# `apps/cloudflare` User Runner

## Scope

- `apps/cloudflare/src/{user-runner.ts,user-runner/**,index.ts,web-control-plane.ts}`
- `apps/cloudflare/test/{user-runner-resume-finalize,runner-run-processor,web-control-plane,hosted-local-duplicate-commit-e2e}.test.ts`
- directly coupled `apps/cloudflare/test/**`

## Focus

- run-drain loop, `nextRuntimeWakeAt`, acquire/commit/finalize coordination, and finalize fencing
- retry, replay, poison, resume, and release-finalize behavior around hosted runs
- Durable Object coordination staying non-authoritative relative to web-owned run state

## Prompt

Review the `apps/cloudflare` user-runner seam using the scope above. Focus on concrete bugs in the run-drain loop, acquire/commit/finalize ordering, finalize resume fencing, timer wake handling, and any retry or replay path that could duplicate side effects or desync from web-owned run truth. Return only evidence-backed findings from current code, prioritizing concrete regressions and behavior-preserving simplification targets that keep the user-runner coordination logic smaller and less stateful. For each finding include `severity`, `file:line`, `issue`, `impact`, and `recommended fix`; list risk findings first, then simplification findings, and say explicitly if a category has no findings.
