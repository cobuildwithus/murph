# detailed-product-feedback

Status: completed
Created: 2026-07-30
Updated: 2026-07-30

## Goal

- Make assistant-captured product feedback specific enough for later triage to
  understand the requested behavior without reopening the private conversation.

## Success criteria

- The feedback tool schema requires concrete product actors, workflow/context,
  expected behavior, observed/requested outcome, and uncertainty when relevant.
- Guidance forbids vague inferred labels and invented interpretation while
  preserving the existing product-only privacy boundary.
- Focused prompt tests prove one model-visible owner for the rubric, and an
  opt-in real-Codex test inspects emitted tool arguments for representative
  ordinary and managed-turn scenarios.
- Required prompt/product/coverage review and exact-head CI complete.

## Scope

- In scope: the assistant feedback tool schema and focused unit/real-Codex
  regression tests.
- Out of scope: database schema changes, longer summaries, raw conversation
  retention, feedback-table mutation, or a feedback-management UI.

## Constraints

- Technical constraints: retain the existing bounded summary contract and
  best-effort asynchronous persistence behavior.
- Product/process constraints: never store raw wording, health details,
  identifiers, contact details, secrets, or provider payloads.

## Risks and mitigations

1. Risk: Greater detail could cause raw or sensitive conversation content to
   leak into stored summaries.
   Mitigation: require product-only abstractions and explicitly preserve every
   existing privacy exclusion.
2. Risk: The model could invent specificity when the source is ambiguous.
   Mitigation: require uncertainty to remain explicit and forbid replacing
   missing details with inferred labels.

## Tasks

1. Inspect every feedback-capture instruction surface and existing tests.
2. Add one summary-quality rule at the single model-visible ownership point.
3. Add focused regression assertions and run prompt/package verification.
4. Commit, push, open a PR, and complete required specialist review and CI.

## Decisions

- Keep the 500-character storage limit; the defect is lossy summarization, not
  insufficient storage.
- Do not add persisted fields or a new feedback taxonomy.
- Keep the detailed rubric solely in the feedback tool schema. The ordinary
  system prompt and managed product-notes history already carry qualification,
  lifecycle, and privacy policy; repeating the field rubric there adds prompt
  cost and creates drift risk.
- Accept the preliminary specialist coverage finding by adding a real Codex
  app-server test over actual emitted `submit_product_feedback` arguments for a
  concrete failure, ambiguous report, private-detail markers, and managed
  product-notes history.

## Verification

- `pnpm --dir packages/assistant-engine exec vitest run --config
  vitest.config.ts test/assistant-product-feedback.test.ts
  test/model-behavior.test.ts test/managed-automations-core.test.ts
  test/managed-automations.test.ts test/assistant-codex-real-e2e.test.ts`:
  163 passed, 20 opt-in real-model cases skipped.
- `pnpm --dir packages/assistant-engine typecheck`: passed.
- `git diff --check`: passed.
- The opt-in focused real-model command reaches the committed test but is
  blocked locally before provider start because the supported provider-key
  environment is absent. A direct authenticated Codex attempt was also blocked
  before provider start by the local subscription usage limit. Keep this
  verification gap explicit; do not replace the real-model assertion with a
  scripted provider.
- Deterministic installed-Codex request capture, with ephemeral absolute paths
  normalized to fixed placeholders, measures the corrected single-owner delta
  at +68 `o200k_harmony` tokens and +382 UTF-8 bytes for both representative
  individual and group requests.
- Preliminary ReviewGPT returned two accepted findings: add model-boundary
  behavior coverage and remove duplicated rubric text. Both corrections are in
  the current candidate; the preliminary pass is not rerun after a substantive
  result.
- Exact implementation-head CI at
  `f3bfb6e323b2b989cc5c6f87021f0d2729aa32db` passed, including assistant,
  CLI, and platform coverage; release build/typecheck; app verification; host
  matrices; artifact/privacy guards; and the corrected PR metadata gate.
Completed: 2026-07-30
