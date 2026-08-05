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
- No migration or runtime path deletes Codex-native artifacts; excluded
  container-local files may disappear with ordinary runner replacement.
- Marked native-memory HTTP and WebSocket requests fail closed before provider
  egress, with the obsolete relay and usage-accounting path removed.
- Focused config tests and the package typecheck pass.
- Exact-head ReviewGPT and required CI pass on the PR.

## Scope

- In scope: trusted hosted Codex config, the hosted provider-egress boundary,
  their diagnostics/tests, and the durable architecture statement.
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
3. A stale or unexpected process could still emit marked memory traffic.
   Mitigation: retain the two native marker checks and reject those requests at
   the authorized egress boundary before any provider call.

## Tasks

1. Update hosted Codex config and remove obsolete generation-only settings.
2. Remove obsolete native-memory relay, parsing, diagnostics, and usage
   accounting while keeping a fail-closed egress marker check.
3. Update focused config/egress tests and durable architecture guidance.
4. Run focused tests, typecheck, and direct rendered-config proof.
5. Commit, open the PR, run ReviewGPT alongside CI, and resolve findings.

## Decisions

- Disable Codex-native reads with generation because Codex uses one feature
  gate for the memory tools/instructions and the startup generation worker.
- Do not add an artifact-deletion migration; memory files already excluded from
  snapshots may age out with normal ephemeral runner replacement.
- Treat any marked native-memory egress as an invariant violation and reject it
  instead of retaining a dormant transport/accounting subsystem.

## Verification

- Commands to run: focused assistant-runtime config tests, focused Cloudflare
  egress tests, affected package typechecks, `git diff --check`, direct
  generated-config assertions, exact-head CI, and ReviewGPT.
- Expected outcomes: `features.memories`, `memories.use_memories`, and
  `memories.generate_memories` are all false, with no generation model or
  scheduling settings emitted.
