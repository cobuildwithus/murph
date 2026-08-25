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
- Structured-workout authoring supplies semantic tracking identity only; the
  runtime owns the canonical timestamp stored with that card. Generic tracked
  tables continue to supply and preserve the timestamp from their exact read.
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
2. Risk: moving timestamp authorship could overwrite canonical timestamps on
   generic tracked tables.
   Mitigation: stamp only cards with the structured `workout` field, preserve
   generic tracked tables unchanged, then parse through the existing persisted
   schema.
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
- Reaches: private-direct structured workout card creation and refresh; generic
  compact tables, including tracked tables with canonical timestamps, and
  nutrition cards preserve their existing behavior.
- Proof: focused model-facing schema assertions plus a production-path dynamic
  tool call without `snapshotAt` that returns a fully validated persisted card.
- Keep `murph.attach_response_card` as the single composition boundary. The
  measured failures do not justify another tool or delivery path.
- Retain the persisted `snapshotAt` field for durable transcript semantics.
  Derive it at tool acceptance only for structured workouts because their
  canonical read supplies workout identity and content but not a snapshot
  timestamp; preserve model-supplied generic tracked-table timestamps.
- Reuse the existing dynamic-tool contract fingerprint transition. The changed
  private-direct schema rotates one eligible pre-deploy session once, replays
  the existing bounded history, persists the new fingerprint after success,
  and resumes normally on later turns. No additional rollout mechanism is
  needed.

## Product UX walkthrough

- Person and path: a private-direct member starts, resumes, or updates one
  unambiguous verified workout; the model reads the tracked-table skill, sends
  one complete authoring payload, and the existing card attachment remains the
  complete response.
- Evidence: the production dynamic-tool parser accepts the full structured
  workout payload without `snapshotAt`, stamps a canonical current instant,
  executes the normal attachment path, and returns the unchanged structured
  card presentation. Reverse tests prove a generic tracked table still requires
  and preserves its canonical timestamp.
- Failure and recovery: mixed generic/workout shapes remain rejected, invalid
  structured-set semantics retain field-level feedback, and an actually
  oversized semantic workout still selects the existing deterministic full-text
  recovery.
- Differences from plan: final review identified that the first timestamp helper
  also matched generic tracked tables. The predicate is now limited to the
  structured-workout branch, and the existing live-workout E2E inspects the
  model-authored fresh and update calls. The live assertion cannot execute in
  this shell because neither supported provider credential is present; all
  deterministic boundary coverage passes. Ready subject to exact-head review
  and CI.

## Verification

- Passed 59 focused tests across Operator Config schema coverage, Assistant
  Engine response-card parsing/execution, validation feedback, tracked-table
  skill guidance, oversized semantic recovery, and schema-size compaction.
- Passed affected Operator Config and Assistant Engine package typechecks plus
  `git diff --check`.
- Review remediation passed 25 Operator Config tests, 31 response-card tool
  tests, the focused scripted App Server authoring/persistence test, both
  generic tracked-card transcript tests, 4 CLI authoring-versus-persistence
  compatibility tests, and Operator Config, Assistant Engine, and CLI package
  typechecks. The opt-in real-model workout E2E was attempted but stopped at
  preflight because the supported provider credentials are absent; no model
  request was made.
- Captured repeat-stable complete first provider requests through the pinned
  real Codex App Server with `gpt-5.6-terra`, low reasoning, production code
  mode, identical synthetic direct/group card fixtures, and `gpt-tokenizer`
  3.4.0 `o200k_harmony`. The selected provider-visible fields were `include`,
  `input`, `instructions`, `parallel_tool_calls`, `text`, `tool_choice`, and
  `tools` when present; volatile temporary Codex paths and runtime identifiers
  were normalized, and model/reasoning/storage/streaming/service-tier/account/
  cache/client/transport metadata were excluded identically. The reviewed
  generic-timestamp correction was then measured twice at the same generated
  code-mode schema boundary and adds 5 tokens / 20 bytes to the first-reviewed
  request. Final direct impact is therefore 28,421 tokens / 131,826 bytes to
  28,463 / 131,980 (+42 tokens, +0.1478%; +154 bytes, +0.1168%). Group remains
  exactly 23,405 tokens / 107,342 bytes. The direct delta is confined to
  Codex-generated response-card tool/schema guidance in `input`; the deferred
  tracked-table skill is absent from the first request. Measurement-only
  instrumentation and its temporary dependency were removed.
- The first ReviewGPT round found the overly broad timestamp predicate and the
  one-time contract-fingerprint rollout disclosure; both corrections are now
  represented in code, tests, and this plan. Merged current `origin/main` at
  `53ba33ce80` through two-parent merge `8aa1fa7470`; focused tests and all
  affected package typechecks pass afterward. ReviewGPT round 2 and exact-head
  CI remain pending.
