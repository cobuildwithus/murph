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
- `agent-docs/FRONTEND.md` repeats the rule at the implementation boundary.
- The frontend specialist lens uses the same simplicity bar.

## Scope

- In scope: `AGENTS.md`, `agent-docs/FRONTEND.md`, and the frontend specialist
  lens.
- Out of scope: new checklists, artifacts, tooling, or workflow machinery.

## Constraints

- Technical constraints: text only.
- Product/process constraints: keep it memorable and short.

## Risks and mitigations

1. Risk: The instruction gets buried in process language.
   Mitigation: use the same direct sentence in the three existing owners.

## Tasks

1. Add the rule to the three existing owners.
2. Read back the diff and run text-only verification.
3. Complete the prompt-primary review and commit path.

## Decisions

- No new process. Just the rule.

## Verification

- Commands to run: readback, `git diff --check`, `pnpm docs:drift`, and the
  prompt-primary preliminary specialist review.
- Expected outcomes: clear wording, no text errors, no unresolved findings.
