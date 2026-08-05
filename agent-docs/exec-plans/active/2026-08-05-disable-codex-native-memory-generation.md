# Disable Codex-native memory generation

Status: active
Created: 2026-08-05
Updated: 2026-08-05

## Goal

- Stop hosted Codex from generating or consuming Codex-native memory while
  keeping Murph's canonical vault memory unchanged.

## Success criteria

- Generated hosted Codex config disables the memory feature, memory reads, and
  memory generation for every inference provider.
- Existing Codex-native memory artifacts remain inert and are not deleted.
- Focused config tests and the package typecheck pass.
- Exact-head ReviewGPT and required CI pass on the PR.

## Scope

- In scope: trusted hosted Codex config, its diagnostics/tests, and the durable
  architecture statement.
- Out of scope: canonical vault memory, existing artifact deletion, and Codex
  upstream changes.

## Constraints

- Technical constraints: `generate_memories = false` alone does not stop the
  startup worker from processing previously eligible rollouts, so the feature
  gate must also be disabled.
- Product/process constraints: preserve Murph's canonical product memory and
  make the smallest owner-local config change.

## Risks and mitigations

1. A partial toggle could leave the startup generation worker active.
   Mitigation: disable the feature gate and explicitly disable both read and
   generate settings; lock all three values in tests.
2. Warm hosted containers could retain the prior generated config.
   Mitigation: document the immediate runner rollout requirement and verify the
   deployed configuration after merge.

## Tasks

1. Update hosted Codex config and remove obsolete generation-only settings.
2. Update focused config tests and durable architecture guidance.
3. Run focused tests, typecheck, and direct rendered-config proof.
4. Commit, open the PR, run ReviewGPT alongside CI, and resolve findings.

## Decisions

- Disable Codex-native reads with generation because Codex uses one feature
  gate for the memory tools/instructions and the startup generation worker.
- Preserve existing artifacts as inert state rather than deleting user data.

## Verification

- Commands to run: focused assistant-runtime config tests, assistant-runtime
  typecheck, `git diff --check`, direct generated-config assertions, exact-head
  CI, and ReviewGPT.
- Expected outcomes: `features.memories`, `memories.use_memories`, and
  `memories.generate_memories` are all false, with no generation model or
  scheduling settings emitted.
