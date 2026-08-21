# Nutrition Card Specialist Remediation

Status: active
Created: 2026-08-21
Updated: 2026-08-21

## Goal

Resolve the applicable preliminary specialist findings for PR #2110 after the
original compatibility plan was archived: keep daily-card progress policy in
its existing global owner, omit missing-tool instructions from no-progress
routes, and add production-faithful model proof for legacy calorie resolution
and bounded safety recovery.

## Evidence

- The preliminary specialist review of source head `756e93578d4a` returned
  findings. Its canonical-only later attachment finding was already resolved by
  source head `585bc2090621` and independently passed final ReviewGPT round 3.
- The remaining applicable progress finding identified competing rules in the
  food-journal skill and response-card tool while the global progress policy
  still required an update for routine multi-read work.
- The remaining applicable coverage finding identified test-local target
  resolution and pre-scripted tool calls as insufficient proof of model-owned
  decisions.

## Tasks

1. Put the routine daily-card latency exception in the existing global progress
   policy and remove duplicate progress decisions from the skill and card tool.
2. Thread actual progress-tool availability into prompt assembly so a route
   without that tool contains no instruction to call it.
3. Add opt-in real-model E2E coverage where the model receives synthetic
   canonical records and chooses legacy attachment, conflict rejection, exact
   same-id recovery, or fail-closed behavior.
4. Run focused tests, typecheck, provider-input measurement, exact-head final
   ReviewGPT, required CI, and current-base merge proof.

## Constraints

- Do not change Goal state, card validation, or the safety exclusion set.
- Keep the compatibility alias read-only and limited to the daily-card calorie
  slot.
- Add no new runtime state owner, progress tool, queue, or reconciliation path.
- Keep all fixtures synthetic and free of member identifiers or transcript
  wording.

## Verification

- Focused assistant-engine prompt, skill, card, turn-planning, scripted-runtime,
  and opted real-model E2E test files: 8 files passed, 299 tests passed, 75
  opt-in real-provider tests skipped.
- Assistant-engine typecheck and `git diff --check`: passed.
- `pnpm test:diff` across every changed assistant-engine path exited 0. It
  passed affected package typechecks and tests, hosted web tests/lint/dev smoke/
  production build, and Cloudflare Node/Workers verification. The workspace
  boundary step also printed two unrelated existing Junction test import
  diagnostics outside this diff.
- The direct provider-visible prompt/tool subset is 22 `o200k_harmony`
  tokens and 98 serialized bytes larger than reviewed source head `585bc2090621`.
  Applying that exact delta to its complete private-direct measurement gives
  16,071 tokens and 72,204 bytes. The unchanged group route remains 14,187
  tokens and 61,593 bytes.
- Exact-head ReviewGPT round after the substantive remediation and required
  GitHub checks.
