# Verify scheduled reminder language across fresh conversations

Status: completed
Created: 2026-11-04
Updated: 2026-11-04

## Outcome and ownership

Prove that next-day fixed reminders preserve conversational language without
requiring an English observed-language note. Canonical memory and automation
records remain the owners; route planning supplies current state and conversation
history, and cron/outbox own occurrence execution and delivery.

## Scope and constraints

Use synthetic fresh vaults, real Sol authoring and Luna execution, and the
production scheduled occurrence path with a synthetic delivery sink. Run live
journeys sequentially. Do not commit, push, open a PR, or contact members.
No production data, credentials, or machine identifiers enter evidence.

## Product UX and proof

Outcome: one concise reminder in the applicable conversational language.
Reaches: Spanish, Polish, Japanese, English in non-English timezones, and
conversations whose reminder request switches language. The existing priority
of explicit request, explicit preference, current language, and remembered
fallback remains the acceptance contract.
Proof: canonical save/readback, actual execution model, due occurrence, outbox
text, synthetic receipt, and terminal occurrence reconciliation. Compare the
previous English-memory policy locally. Report every sample, including misses.

## Tasks

1. Map composed scheduled prompt, memory, history and thread continuation.
2. Add deterministic context coverage and a reusable fresh-vault live journey.
3. Run each language case twice, then the historical English-policy comparison.
4. Fix only an evidenced defect at its existing owner; rerun affected proof.
5. Run focused suites, package typecheck, diff and complexity checks. Measure
   complete provider input and tokenizer deltas if production prompt text changes.
6. Review the diff and write the local evidence report; close this plan.

## Decisions

- Reuse canonical live fixtures, hosted automation port, cron and outbox owners.
- No new persisted language field or runtime state is justified before evidence.
- A synthetic provider receipt proves the local delivery boundary, not Linq
  service acceptance or handset delivery.

## Verification

- Seven fresh reminder cases each passed twice using real Sol authoring and
  Luna firing through production cron and synthetic outbox receipts.
- Both historical English-policy comparisons passed. The exact previous prompt
  line was used temporarily and restored. No wrong-language output was observed.
- Two unseeded onboarding journeys passed, including identity persistence and
  five scheduled send/skip decisions apiece.
- Three earlier attempts remain in local evidence: a one-shot archival assertion
  error in the pilot, a late-night Japanese date clarification before saving,
  and transient provider capacity before a historical reminder save. The first
  two shaped the test fixture; the third passed on the same-model retry.
- Focused deterministic checks: seven files, 69 tests passed. Offline E2E helper
  checks: one file, 72 passed and 637 live tests skipped.
- Assistant Engine typecheck and diff whitespace checks passed. Complexity guard
  passed with no production source changes. Dependency installation, prepared
  test-runtime build and Health Commons generation passed.
- Product UX: Ready for the tested reminder and onboarding scenarios. Every
  completed occurrence delivered one concise message in the applicable language.
  A synthetic receipt does not establish real provider or handset delivery.
- No production fix is justified by the evidence. Production prompt/input delta
  is zero; no measurement harness or tokenizer run was needed. No changelog or
  external completion review applies to these test-only changes.
- Local report retains the source map, every delivered reminder verbatim,
  memory/instruction evidence, command results and all attempt dispositions.
  No commit, push or PR was created, per the explicit task boundary.
Completed: 2026-11-04
