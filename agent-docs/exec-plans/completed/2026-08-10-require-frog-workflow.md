# Require Frog logging in agent workflows

Status: completed
Created: 2026-08-10
Updated: 2026-08-10

## Goal

- Make Frog part of Murph's mandatory edit-task workflow so agents inspect
  existing friction before workarounds, record qualifying new friction, and
  commit every created Frog entry with the task that exposed it.

## Success criteria

- `AGENTS.md` routes edit-authorized work to the Frog skill.
- The durable workflow contract defines when logging is required and forbids
  completing a task with an uncommitted Frog entry.
- The Frog skill and completion workflow require public-safe readback and
  same-task commit inclusion without manufacturing empty reports.
- Markdown readback, reference checks, and the existing focused Frog workflow
  guards pass.

## Scope

- In scope: `AGENTS.md`, the agent workflow router, completion workflow, and
  Frog skill instructions.
- Out of scope: changing Frog's storage, publishing workflow, issue lifecycle,
  or Murph's product-feedback, support, and runtime-issue owners.

## Constraints

- Technical constraints: reuse the existing `scripts/frog` wrapper and skill;
  add no new state owner, dependency, hook, or publishing path.
- Product/process constraints: log only new, reproducible, repository-actionable
  friction during edit-authorized work; preserve public-data exclusions and do
  not delay the requested outcome.

## Risks and mitigations

1. Risk: An unconditional logging rule creates empty or low-signal issue spam.
   Mitigation: Require logging only when qualifying friction actually occurs.
2. Risk: A local entry is omitted from a scoped commit and never reaches the
   publishing workflow.
   Mitigation: Make same-task commit inclusion an explicit completion gate in
   both the durable workflow and Frog skill.

## Tasks

1. Add the compact root workflow pointer and durable logging contract.
2. Add the same-task commit requirement to Frog and completion instructions.
3. Read back the resulting policy, run focused proof, and archive this plan in
   the scoped commit.

## Decisions

- Keep enforcement instructional and covered by the existing Frog policy test;
  do not add a second commit hook or state scanner before evidence shows agents
  bypass the documented scoped-commit path.
- Treat tracked plan-file creation or updates as edit-authorized work. Reserve
  the handoff-only exemption for review-only, planning-only, and other requests
  that do not authorize repository edits.

## Verification

- Commands to run: `scripts/frog list`; focused Frog workflow Vitest;
  `pnpm docs:drift`; `git diff --check`; targeted reference/readback searches.
- Expected outcomes: Frog lists the repository store, policy assertions pass,
  durable-doc drift is clean, and every required entry point states a coherent
  public-safe same-task commit contract.
Completed: 2026-08-10
