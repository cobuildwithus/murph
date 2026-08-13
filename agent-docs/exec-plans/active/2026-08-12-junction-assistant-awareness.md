# Improve Murph awareness of expanded Junction data

Status: active
Created: 2026-08-12
Updated: 2026-08-12

## Goal

- Teach Murph to discover and interpret the newly normalized Junction wearable
  signals through existing vault surfaces without adding commands, state, or
  unsupported clinical claims.

## Success criteria

- The system prompt names the expanded data families and routes reads through
  existing normalized wearable commands.
- The smallest relevant assistant skills use the new signals when they answer
  the member's question while preserving missing-data and health-safety bounds.
- Focused assistant-engine tests and typecheck pass.
- The exact pushed PR head passes the required preliminary ReviewGPT prompt,
  product-experience, and coverage lenses plus required GitHub checks.

## Scope

- In scope: assistant system-prompt guidance, one or two existing skill edits,
  focused contract tests, and the required PR/review evidence.
- Out of scope: new CLI commands, new skills, importer/query changes, raw ECG
  waveform access, new persistence, and broad coaching-policy rewrites.

## Constraints

- Technical constraints: stack on the Junction configurable-resources branch;
  reuse `vault-cli wearables metric latest|trend` and existing category reads;
  do not imply that every source supplies every metric.
- Product/process constraints: keep member-facing behavior concise, treat
  alerts and ECG summaries as clues rather than diagnoses, and use the
  prompt-primary worktree/PR completion lane.

## Risks and mitigations

1. Risk: Murph overstates availability when a source is disconnected or did
   not provide a metric.
   Mitigation: distinguish recognized metric families from observed readings
   and require source/coverage-aware wording.
2. Risk: a broad metric inventory bloats the always-on prompt.
   Mitigation: keep the system prompt categorical and put only task-relevant
   interpretation detail in existing skills.
3. Risk: ECG, fall, apnea, or heart-alert signals become diagnostic claims.
   Mitigation: preserve symptom-first safety routing and explicitly prohibit
   diagnosis or reassurance from a device signal alone.

## Tasks

1. Inspect the exact Junction head, assistant prompt, skill ownership, tests,
   and existing Frog entries.
2. Draft the smallest prompt and skill changes with focused coverage.
3. Ask ReviewGPT to inspect the exact candidate using the required prompt,
   product-experience, and coverage lenses; resolve accepted findings.
4. Run focused verification, commit, push, open the stacked PR, and wait for
   required exact-head CI.
5. Complete the parent review, archive this plan with the final scoped commit,
   and prove a clean merge tree against the PR base.

## Decisions

- Keep capability awareness in the existing vault-navigation prompt instead of
  introducing another tool or command surface.
- Stack on `codex/junction-configurable-resources` so prompt knowledge cannot
  reach production before its importing and query contracts.
- Reuse the existing execution-plan helper Frog entries; do not create a
  duplicate friction report for its `--help` behavior.

## Verification

- Commands to run: focused Vitest files for the prompt and edited skills;
  assistant-engine typecheck; exact-head GitHub checks; ReviewGPT specialist
  pass; `git merge-tree --write-tree` against the stacked PR base.
- Expected outcomes: all commands pass, ReviewGPT has no unresolved accepted
  findings, and the final diff contains no new runtime surface or state owner.
