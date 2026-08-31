# Preserve canonical memory repair context during onboarding resume

Status: completed
Created: 2026-08-30
Updated: 2026-08-30

## Goal

- Keep a canonical memory-document parse failure terminal and actionable when
  `assistant onboarding resume-context` reads memory alongside the other
  onboarding surfaces.

## Product UX

- Outcome: an agent resuming onboarding learns that canonical memory needs one
  bounded repair instead of retrying a permanent parse failure.
- Reaches: the existing onboarding resume snapshot changes only when its memory
  read throws the canonical memory-document-invalid error; all other setup
  surfaces continue resolving independently.
- Proof: a built CLI regression proves the safe terminal memory result, other
  available surfaces, and byte-identical memory file, then one focused real-Codex
  journey proves the agent responds without retrying or writing.

## Success criteria

- The onboarding memory surface returns `memory_document_invalid` with
  `retryable: false` for the existing canonical parse error.
- Its hint contains only the canonical vault-relative `bank/memory.md` location
  and any bounded safe field name; it never echoes record text, record IDs, or
  an absolute path.
- Unknown memory failures retain the existing generic classification, and
  failures in other setup surfaces keep their current independent behavior.
- The corrupt memory file remains byte-identical and the focused real-Codex
  journey performs no retry or write.

## Scope

- In scope:
  - The onboarding resume-context memory-surface error projection.
  - Focused built CLI and real-Codex recovery proof.
- Out of scope:
  - Automatic repair, retry loops, new state owners, generic error remapping,
    healthy memory output, or unrelated CLI UX findings.

## Constraints

- Recognize only the existing canonical memory parser error at the memory
  surface boundary and construct recovery output from fixed or strictly bounded
  metadata.
- Preserve concurrent independent reads for goals, regimens, supplements,
  conditions, allergies, experiments, and device accounts.
- Use synthetic private-free fixtures only.

## Tasks

1. [x] Add the narrow onboarding memory error projection.
2. [x] Add deterministic built CLI proof for safe terminal recovery, independent
   surfaces, and no write.
3. [x] Add and run the focused production-derived real-Codex journey, then
   inspect the member-visible reply.
4. [x] Run touched-package typechecks and focused tests, inspect the diff for
   privacy and scope, and prepare the exact-head draft PR update.

## Verification

- Focused built `packages/cli/test/assistant-cli.test.ts` regression.
- Focused `packages/assistant-cli` command coverage where needed.
- Touched-package typechecks.
- `pnpm test:assistant:live -- --test "<unique recovery journey>"`.
- `git diff --check` and a private-identifier scan of changed files.

## Results

- The assistant CLI command suite passed 19 of 19 tests after the narrow
  projection change.
- The assistant CLI build and focused built-runtime onboarding regression
  passed; the regression proved the terminal safe hint, six independently
  available surfaces, and a byte-identical canonical memory file.
- Typechecks passed for `@murphai/assistant-cli`, `@murphai/murph`, and
  `@murphai/assistant-engine`.
- The focused onboarding skill-asset guard passed with the final compact rule.
- The focused real-Codex journey passed with `gpt-5.6-terra` through local
  subscription authentication: one resume-context command, no direct memory
  command, one provider request, no onboarding advance, and an actionable
  vault-relative file, line, and field repair target.
- Product UX verdict: Ready. Correctness, clarity, truthful recovery, bounded
  action count, non-repetition, and autonomy are directly proven; the concise
  response stops at the repair boundary without pretending the saved context
  is usable.
Completed: 2026-08-30
