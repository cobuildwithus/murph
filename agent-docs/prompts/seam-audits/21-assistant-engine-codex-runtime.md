---
description: One-pass seam audit prompt for assistant-engine Codex turn runtime and tool assembly
---

# `@murphai/assistant-engine` Codex Runtime And Tool Assembly

## Scope

- `packages/assistant-engine/src/{model-harness.ts,assistant-provider.ts,assistant-runtime.ts,assistant-service.ts}`
- `packages/assistant-engine/src/assistant/{codex-runtime.ts,codex-turn-runner.ts,codex-thread-route.ts,codex-resume-binding.ts,codex-turn/**,execution-plan.ts,provider-failure-diagnostics.ts,provider-catalog.ts,cli-surface-bootstrap.ts,operator-authority.ts,system-prompt.ts,turns.ts}`
- `packages/assistant-engine/src/assistant/providers/{codex-cli.ts,helpers.ts,types.ts,catalog.ts}`
- `packages/assistant-engine/src/assistant-cli-tools/{catalog-profiles.ts,capability-definitions.ts,policy-wrappers.ts}`
- directly coupled `packages/assistant-engine/test/**`

## Focus

- Codex turn execution, operator authority, and tool/runtime assembly
- Codex-specific divergence that could change Murph authority or helper exposure
- recovery/failover, continuity/bootstrap handling, and bounded-helper assumptions around model backends

## Prompt

Review the Codex turn runtime and tool-assembly seam in `@murphai/assistant-engine` using the scope above. Focus on concrete bugs in Codex authority binding, tool-catalog exposure, turn recovery/failover, backend-specific behavior drift, and any trust-boundary mistake that could widen assistant capabilities unintentionally. Return only evidence-backed findings from current code, prioritizing concrete regressions and behavior-preserving simplification targets that make Codex runtime differences narrower and authority boundaries clearer. For each finding include `severity`, `file:line`, `issue`, `impact`, and `recommended fix`; list risk findings first, then simplification findings, and say explicitly if a category has no findings.
