# Add durable guidance against unsafe escape-hatch casts

Status: completed
Created: 2026-04-01
Updated: 2026-04-01

## Goal

- Add a durable repo rule that forbids `as any` and lazy `as unknown` casting shortcuts in normal implementation work.

## Success criteria

- The canonical agent workflow docs tell agents not to use `as any` or throwaway `as unknown` casts to silence TypeScript errors.
- The rule lives in one durable, high-precedence place rather than being repeated across multiple docs.
- The change lands as a scoped docs-only commit with the plan closed.

## Scope

- In scope:
  - `AGENTS.md`
  - This execution plan and the coordination-ledger entry needed while the task is active
- Out of scope:
  - Lint rule or code-enforcement changes
  - Repo source/test edits beyond doc examples if they become necessary

## Constraints

- Technical constraints:
  - Keep `AGENTS.md` short and route-oriented.
  - Phrase the rule so narrow, justified trust-boundary assertions remain possible without blessing broad escape-hatch casts.
- Product/process constraints:
  - Follow the docs/process-only workflow with a narrow ledger row and plan artifact.
  - Use the docs-only verification fast path by reading back the touched Markdown.

## Risks and mitigations

1. Risk: The rule could be too broad and read like a ban on all assertions, including legitimate boundary narrowing.
   Mitigation: Scope the wording to lazy error-suppression casts and explicitly point agents toward proving types or using narrow, justified assertions.
2. Risk: The repo could end up with the same rule duplicated across multiple docs.
   Mitigation: Put the durable rule in the highest-precedence small doc and avoid restating it elsewhere unless future tooling needs a pointer.

## Tasks

1. Add a narrow ledger row and open a tiny plan for the durable-rule update.
2. Add one concise hard-rule bullet in `AGENTS.md` covering `as any` and lazy `as unknown` casting.
3. Read back the touched Markdown, close the plan, and commit only the scoped docs artifact(s).

## Decisions

- `AGENTS.md` is the canonical home because this is a repo-wide agent behavior rule and the hard-rules section already carries the highest-precedence durable invariants.

## Verification

- Commands to run:
  - None. This task qualifies for the text-only Markdown docs fast path.
- Direct proof:
  - Read back the touched `AGENTS.md` hard-rules section and the completed plan artifact for accuracy.
- Expected outcomes:
  - The new rule is present, concise, and does not expand `AGENTS.md` into a broad style guide.
Completed: 2026-04-01
