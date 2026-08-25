# Workout card authoring contract

Status: active
Created: 2026-08-25
Updated: 2026-08-25

## Goal

- Make verified workout cards author reliably on the first tool call without
  adding another card tool, state owner, or retry mechanism.

## Success criteria

- The model-facing compact-table schema presents generic and workout cards as
  two complete, locally understandable alternatives.
- The model supplies semantic workout tracking identity only; the runtime owns
  the canonical tracking timestamp stored with the accepted card.
- The tracked-workout skill contains one complete outer tool payload and no
  partial example that can be mistaken for the whole card.
- Focused schema, prompt, runtime, and type checks pass, and the provider-facing
  schema remains below the Codex compaction boundary.

## Scope

- In scope: the private response-card authoring schema, workout prompt guidance,
  runtime input normalization, and focused regression coverage.
- Out of scope: a second card tool, renderer or native-card changes, workout
  persistence changes, generic retry machinery, and nutrition behavior.

## Constraints

- Technical constraints: preserve the persisted response-card contract and the
  one-tool architecture; keep the normalized dynamic-tool schema under 5 KB;
  validate the final host-enriched card through the existing authoritative Zod
  schemas.
- Product/process constraints: use synthetic examples only, preserve private
  direct card eligibility and deterministic text fallback, and run the prompt
  and coverage specialist gate on the exact pushed candidate.

## Risks and mitigations

1. Risk: explicit schema branches could cross the provider compaction boundary.
   Mitigation: reuse one shared schema-property definition in code and retain
   the executable normalized-size guard.
2. Risk: moving timestamp authorship could weaken canonical card validation.
   Mitigation: stamp it only at the runtime boundary, then parse the enriched
   payload with the unchanged persisted-card schema.
3. Risk: prompt duplication could drift.
   Mitigation: keep one complete example in the tracked-table skill and only a
   short structural rule in the tool description.

## Tasks

1. [completed] Prove the production validation failures and trace the current
   model-facing schema, prompt, runtime parser, and timestamp consumers.
2. [completed] Make the two compact-table alternatives explicit and move the
   tracking timestamp to runtime ownership.
3. [completed] Add focused first-call authoring and prompt regressions.
4. [completed] Run focused verification, inspect provider-input size, and
   complete the Product UX walkthrough.
5. [in_progress] Commit, push, open the PR, run the required specialist and final
   gates, and require green exact-head CI.

## Decisions

- Product UX level: Patch.
- Outcome: a member who starts, resumes, or updates one verified workout gets
  the existing structured workout card without an avoidable validation detour.
- Reaches: private-direct workout card creation and refresh; generic compact
  tables and nutrition cards preserve their existing behavior.
- Proof: focused model-facing schema assertions plus a production-path dynamic
  tool call without `snapshotAt` that returns a fully validated persisted card.
- Keep `murph.attach_response_card` as the single composition boundary. The
  measured failures do not justify another tool or delivery path.
- Retain the persisted `snapshotAt` field for durable transcript semantics, but
  derive it at tool acceptance because no canonical read command supplies it
  and no renderer consumes model-authored timestamp data.

## Product UX walkthrough

- Person and path: a private-direct member starts, resumes, or updates one
  unambiguous verified workout; the model reads the tracked-table skill, sends
  one complete authoring payload, and the existing card attachment remains the
  complete response.
- Evidence: the production dynamic-tool parser accepts the full workout payload
  without `snapshotAt`, stamps a canonical current instant, executes the normal
  attachment path, and returns the unchanged structured card presentation.
- Failure and recovery: mixed generic/workout shapes remain rejected, invalid
  structured-set semantics retain field-level feedback, and an actually
  oversized semantic workout still selects the existing deterministic full-text
  recovery.
- Differences from plan: none. Ready.

## Verification

- Passed 59 focused tests across Operator Config schema coverage, Assistant
  Engine response-card parsing/execution, validation feedback, tracked-table
  skill guidance, oversized semantic recovery, and schema-size compaction.
- Passed affected Operator Config and Assistant Engine package typechecks plus
  `git diff --check`.
- Captured repeat-stable complete first provider requests through the pinned
  real Codex App Server with `gpt-5.6-terra`, low reasoning, production code
  mode, identical synthetic direct/group card fixtures, and `gpt-tokenizer`
  3.4.0 `o200k_harmony`. The selected provider-visible fields were `include`,
  `input`, `instructions`, `parallel_tool_calls`, `text`, `tool_choice`, and
  `tools` when present; volatile temporary Codex paths and runtime identifiers
  were normalized, and model/reasoning/storage/streaming/service-tier/account/
  cache/client/transport metadata were excluded identically. Direct changes
  from 28,421 tokens / 131,826 bytes to 28,458 / 131,960 (+37 tokens,
  +0.1302%; +134 bytes, +0.1016%). Group remains exactly 23,405 tokens /
  107,342 bytes. The direct delta is confined to Codex-generated code-mode
  response-card tool/schema guidance in `input`; the deferred tracked-table
  skill is absent from the first request. Measurement-only instrumentation was
  removed.
- Merged current `origin/main` before the final provider capture. Required
  ReviewGPT and exact-head CI gates remain pending.
