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
- Final ReviewGPT round 4 found that the invocation-aware global progress owner
  still coexisted with research-owned timing and a media-specific bare tool
  directive. A direct email route could therefore omit the tool while retaining
  an impossible instruction to call it.

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
5. Delete the research and media progress directives, keep their evidence and
   bounded-inspection contracts, and prove complete no-progress email plus
   progress-capable direct/group prompts have one executable global owner.

## Constraints

- Do not change Goal state, card validation, or the safety exclusion set.
- Keep the compatibility alias read-only and limited to the daily-card calorie
  slot.
- Add no new runtime state owner, progress tool, queue, or reconciliation path.
- Keep all fixtures synthetic and free of member identifiers or transcript
  wording.

## Verification

- Focused assistant-engine prompt, skill, card, research, turn-planning,
  scripted-runtime, and opted real-model E2E test files: 9 files passed, 301
  tests passed, 75 opt-in real-provider tests skipped. The round-4 assembled
  route also passed independently in the turn-planning file's 91-test run.
- Assistant-engine typecheck and `git diff --check`: passed.
- `pnpm test:diff` across every changed assistant-engine path exited 0. It
  passed affected package typechecks and tests, hosted web tests/lint/dev smoke/
  production build, and Cloudflare Node/Workers verification. The workspace
  boundary step also printed two unrelated existing Junction test import
  diagnostics outside this diff.
- The specialist delta initially added 22 `o200k_harmony` tokens and 98
  serialized bytes over reviewed source head `585bc2090621`. Round-4 deletion
  then removed 25 tokens / 129 bytes from private direct input and 19 tokens /
  104 bytes from group input. The resulting complete measurements are 16,046
  tokens / 72,075 bytes for private direct and 14,168 / 61,489 for group.
- Exact-head ReviewGPT round after the substantive remediation and required
  GitHub checks.
