# Reduce Murph AI context and tool-loop cost

Status: completed
Created: 2026-07-10
Updated: 2026-07-10

## Goal

- Cut Murph's per-conversation AI token cost with the smallest production-safe changes to repeated prompt context, provider/tool round trips, and model-visible tool output.
- Preserve Murph's full supported task capability, tool discovery, native Codex continuity, and exact external-effect status/ambiguity semantics.

## Success criteria

- Current production code paths for the audit's highest-cost multipliers are traced and only measured, high-confidence levers are changed.
- Deterministic tests prove the intended prompt/tool-output reduction and protect task correctness and discovery behavior.
- The selected changes have a documented savings mechanism that can plausibly contribute to the audited 25% target without depending on lower answer quality.
- Required scoped verification, completion audits, parent final review, PR CI, merge-conflict check, and ReviewGPT rounds all pass with no unresolved accepted findings.

## Scope

- In scope: align the on-demand computer-use skill with the existing macro-step tool contract, remove the duplicate successful JSON representation from `vault-cli batch`, compact the resident CLI contract while retaining every exact command name and protected hot-path signatures, and add directly matching tests.
- Out of scope: context-snapshot lifecycle changes, prompt telemetry renames, capability gating, generic dynamic-tool truncation, connected-app result shaping, model downgrades, lower global compaction thresholds, response-quality reductions, unrelated assistant/runtime refactors, and new orchestration or persisted state.

## Constraints

- Technical constraints: native Codex thread/resume/compaction semantics remain authoritative; result shaping must preserve IDs, write status, dates/times, totals, provenance, and ambiguity; no invalid-JSON truncation contract may be introduced.
- Product/process constraints: default to deletion and existing owners, keep the implementation composable and narrow, preserve unrelated worktree changes, and use the required isolated PR plus ReviewGPT completion lane.

## Risks and mitigations

1. Risk: browser macro-steps batch across a choice, private-input boundary, or irreversible confirmation.
   Mitigation: preserve the existing decision boundaries explicitly and require bounded waits plus final-state verification inside each safe macro-step.
2. Risk: compacting the CLI contract causes extra discovery calls or hides a supported route.
   Mitigation: retain all exact command names in a family index, keep five deploy-protected hot commands fully runnable, and direct the model to existing group/leaf JSON schemas for missing details.
3. Risk: output compaction hides external-effect outcomes or creates retry ambiguity.
   Mitigation: remove duplication before summarizing and test exact status/identity/ambiguity retention on representative large results.

## Tasks

1. Complete — reconciled the audit against latest `main`, quantified current prompt/result behavior, and selected three high-confidence levers.
2. Complete — added focused failing regressions for each selected savings mechanism.
3. Complete — implemented the narrow production changes at existing owner boundaries.
4. Complete — scoped verification, the required coverage-write audit, and parent final review completed; the one accepted partial-index finding was fixed and proved.
5. In progress — finish the plan through the scoped commit helper, rebase onto current `origin/main`, push, open the PR with the intent contract, and run ReviewGPT plus CI to completion.

## Decisions

- Use the PR worktree lane from current `origin/main`; do not touch the dirty, divergent main checkout.
- Treat the 25% goal as a portfolio target: prefer independently measurable reductions over a single broad rewrite.
- Keep native thread context, context snapshots, system-prompt assembly, and telemetry unchanged because a safe dedupe boundary was not proven and another active lane owns prompt placement.
- Replace repeated non-hot CLI descriptions/schemas with one compact family index containing every exact command name; preserve full options for the five existing deploy-protected hot commands.
- For successful batch children, return parsed JSON as `data` or non-JSON as `stdout`, never both; failures retain raw `stdout` and error ambiguity.

## Measured evidence

- Generated resident CLI contract: 32,809 characters / 6,895 o200k tokens before; 5,977 characters / 1,665 tokens after. Reduction: 81.8% by characters and 75.9% by tokens, while retaining 292 command names.
- Representative two-command batch result: 4,132 normalized bytes with the legacy duplicate representation versus 2,210 bytes after, a 46.5% reduction; successful parsed results retained identical `data` and omitted only duplicate `stdout`.
- Browser guidance: removed the skill-level micro-step phrases that contradicted the existing tested tool contract and replaced single-click examples with bounded action-plus-verification macro-steps.

## Verification

- Commands to run: focused Vitest regressions while iterating; package typechecks; `pnpm test:diff` over every touched owner; direct prompt/result-size measurements; `git diff --check`; required coverage audit; PR-head preflight; PR CI; `pnpm review:gpt pr-review` rounds.
- Expected outcomes: all selected owners and reverse dependents pass, direct measurements show less model-visible input with preserved semantics, the PR head is clean/pushed/mergeable, CI is green, and the final ReviewGPT round has zero accepted findings.
- Local outcomes: assistant-engine focused tests passed 85/85; CLI batch tests passed 8/8; both owner typechecks and the assistant-engine build passed; the generated contract remains 5,977 characters / 1,665 tokens; `git diff --check` passed.
- The required diff-aware lane passed repository guards and all affected typechecks. Its broad package-test phase encountered unrelated shared-machine timing failures in reverse dependents; the prior run and audit reruns reproduced those only under saturation, while the changed-owner focused paths and previously failing isolated tests passed.
- Coverage-write added exhaustive reconstruction proof for 306 normalized root/multi-token commands and an over-budget fail-loud regression. The parent replaced the raw 45,000-character slice with `null`, so the existing prebuild generator fails rather than shipping a partial catalog; both new focused tests pass and no audit findings remain.
Completed: 2026-07-10
