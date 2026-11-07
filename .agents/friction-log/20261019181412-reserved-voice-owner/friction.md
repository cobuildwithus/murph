---
title: 'Reserved-voice owner handoff exceeded its one-second deadline during acceptance'
severity: 'minor'
---

## Expected Behavior

The reserved-voice empty-invocation test should prove that an owner-handoff wake releases the current invocation and fences new calls before returning, consistently within its existing deadline.

## Current Behavior

Canonical local acceptance at a89bd548 failed only the owner-handoff variant in hosted-runtime-workspace-entrypoint-voice.test.ts: its one-second race timed out. The call-close and shutdown variants passed. This test and the entire assistant-runtime package are unchanged from the PR base, the scenario starts no provider, and exact-head assistant-runtime coverage in CI passed. All five file cases passed in three isolated reruns, followed by the full assistant-runtime coverage lane (3,740 passed, seven skipped). The clean canonical acceptance rerun subsequently passed with exit 0 in 2,445 seconds, including the same unmodified owner-handoff test. The cause is unresolved; scheduler contention is only a hypothesis, and a runtime wake interaction is not excluded. No assertion or deadline was weakened.

## Minimal Reproducible Example

Run pnpm verify:acceptance on the Codex 0.163.0 candidate. If the reserved-voice owner-handoff variant fails, compare the full package lane with the focused hosted-runtime-workspace-entrypoint-voice.test.ts run. The failure is intermittent and the exact trigger is not established.

## Context

The failed acceptance attempt remains evidence. Focused passes do not substitute for a clean canonical acceptance result or establish a root cause. Diagnose the wake and test scheduling boundary before proposing a production change or loosening timing assertions.
