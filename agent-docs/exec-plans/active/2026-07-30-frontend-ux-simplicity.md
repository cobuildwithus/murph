# Frontend UX simplicity implementation and review standard

Status: active
Created: 2026-07-30
Updated: 2026-07-30

## Goal

- Put one blunt simplicity rule where frontend implementers and reviewers will
  see it.

## Success criteria

- `AGENTS.md` tells frontend implementers to think deeply about UX and build the
  simplest complete version.
- The frontend specialist lens enforces the same simplicity bar without
  second-guessing product-owned requirements.

## Scope

- In scope: `AGENTS.md` and the frontend specialist lens.
- Out of scope: new checklists, artifacts, tooling, or workflow machinery.

## Constraints

- Technical constraints: text only.
- Product/process constraints: keep it memorable and short.

## Risks and mitigations

1. Risk: Simplicity language could encourage removal of required UX.
   Mitigation: explicitly preserve required behavior, states, accessibility,
   responsiveness, and recovery.

## Tasks

1. Add the rule to the two existing owners.
2. Read back the diff and run text-only verification.
3. Complete the prompt-primary review and commit path.

## Decisions

- No new process. Just the rule.

## Verification

- Commands to run: readback, `git diff --check`, `pnpm docs:drift`, and the
  prompt-primary preliminary specialist review.
- Expected outcomes: clear wording, no text errors, no unresolved findings.
