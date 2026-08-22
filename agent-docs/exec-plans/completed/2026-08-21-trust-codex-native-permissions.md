# Trust Codex native permissions for ordinary tasks

Status: completed
Created: 2026-08-21
Updated: 2026-08-21

## Goal

- Make the repository default explicit: ordinary, reversible Murph work should
  trust clear prompts and native Codex controls instead of adding feature-local
  supervision or sandbox machinery.

## Success criteria

- `AGENTS.md` names the roughly 90% ordinary-task default.
- The guidance calls out memory automation as an example.
- Security, privacy, authorization, canonical-write, and irreversible-effect
  boundaries remain mechanically enforced.
- The rule stays aligned with `docs/contracts/00-invariants.md` § Trust Codex
  Native Capabilities.

## Scope

- In scope: one concise addition to the top-level simplicity guidance.
- Out of scope: changing runtime code, existing permissions, or production
  behavior.

## Constraints

- Technical constraints: keep the change Markdown-only and preserve existing
  hard security and authority boundaries.
- Product/process constraints: keep `AGENTS.md` compact and avoid duplicating
  the full invariant.

## Risks and mitigations

1. Risk: The trust default could be read as permission to remove required
   enforcement.
   Mitigation: Limit it to ordinary, reversible tasks and name the boundaries
   that still require machinery.

## Tasks

1. [x] Add the concise trust default to `AGENTS.md`.
2. [x] Read back the touched text and confirm its invariant reference.
3. [x] Inspect the final diff and create a scoped commit.

## Decisions

- Place the guidance beside the repository's deletion-and-simplicity default so
  it shapes architecture before implementation.

## Verification

- Passed focused Markdown readback for `AGENTS.md` and this plan.
- Passed the reference lookup for `docs/contracts/00-invariants.md` § Trust
  Codex Native Capabilities.
- Passed `git diff --check` and final diff/privacy inspection; only the scoped
  Markdown files changed, with no direct personal identifiers.
Completed: 2026-08-21
