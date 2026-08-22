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
- Final ReviewGPT round 5 found that automatic closeout repeated the complete
  safety gate it already required from the shared nutrition-card safety
  reference. The duplicate made future safety changes vulnerable to drift and
  made the dynamically loaded skill larger without adding an authority owner.
- Final ReviewGPT round 6 found that the raw `calories` key also names total
  wearable energy expenditure, so a global key-only alias could adopt a burn
  Goal as dietary intake or let it conflict with a valid canonical target. The
  original production evidence instead proves one accepted Goal containing the
  older calorie target together with all four nutrition-specific targets.

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
6. Keep the shared nutrition-card safety reference as the only complete safety
   owner; reduce automatic closeout to ordering that gate before target and card
   work plus its scheduled fail-closed disposition.
7. Narrow legacy compatibility to one complete same-Goal nutrition bundle.
   Canonical dietary authority ignores every ambiguous raw calorie target;
   alias-only activity Goals and cross-Goal combinations cannot authorize or
   conflict with a card.

## Constraints

- Do not change Goal state, card validation, or the safety exclusion set.
- Keep the compatibility alias read-only, limited to the daily-card calorie
  slot, and authorized only by its complete same-Goal nutrition bundle.
- Add no new runtime state owner, progress tool, queue, or reconciliation path.
- Keep all fixtures synthetic and free of member identifiers or transcript
  wording.

## Verification

- Focused assistant-engine prompt, skill, card, research, turn-planning,
  scripted-runtime, and opted real-model E2E test files: 9 files passed, 301
  tests passed, 75 opt-in real-provider tests skipped. The round-4 assembled
  route also passed independently in the turn-planning file's 91-test run.
- Assistant-engine typecheck and `git diff --check`: passed.
- Round-5 remediation proof passed 131 tests across the automatic-capture
  contract, shared safety owner, scripted runtime, and response-card boundary.
  The scheduled runtime coverage still proves safe attachment, exact recovery
  acceptance, bad recovery rejection, saturation before detail fanout, and no
  question, Goal/measurement mutation, or card on safety failure.
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
- The round-5 deletion does not change initial provider input because the
  automatic-capture skill is loaded later on demand. Its provider-visible skill
  payload itself shrank by 2,598 serialized bytes and 34 net production lines;
  the initial direct/group measurements therefore remain 16,046 / 72,075 and
  14,168 / 61,489.
- Round-6 remediation proof covers the intended same-Goal legacy bundle,
  canonical dietary authority beside a separate calorie-burn Goal, and an
  alias-only burn Goal beside separate macros. Each path proves the expected
  card or fallback and no Goal mutation through the complete App Server tool
  surface; the opt-in real-model fixture retains the same semantic matrix. The
  focused remediation run passed 5 files and 137 tests, with 75 credential-
  gated real-provider cases skipped; assistant-engine typecheck and
  `git diff --check` passed. Changelog generation and its four focused files
  passed 57 tests. Exact-head coverage then measured the intentional resident
  response-card authority wording at 59,022 characters, 112 above the prior
  ratchet; the ratchet was updated to that exact value and its focused file
  passed 74 tests without changing provider behavior.
- Exact-head app verification then exposed a current-base test-harness mismatch:
  the group-email test mocked the mailbox store without the new
  `appendHostedMailboxEnvelopeWithIdentityTx` export now loaded by the shared
  hosted-Web testkit. The branch adds that missing test-only mock; the failure
  is outside the nutrition runtime path and changes no production behavior.
- Exact-head ReviewGPT round after the substantive remediation and required
  GitHub checks.
