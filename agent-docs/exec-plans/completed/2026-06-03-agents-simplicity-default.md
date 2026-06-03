# Add AGENTS simplicity default

Status: completed
Created: 2026-06-03
Updated: 2026-06-03

## Goal

- Add the requested deletion-and-simplicity default to the top of `AGENTS.md`
  as durable agent guidance.

## Success criteria

- `AGENTS.md` starts with a clear simplicity/deletion principle before the
  existing routing sections.
- No unrelated repo docs or workflow policy are changed.
- Required docs/process verification passes for the touched Markdown file.

## Scope

- In scope:
  - `AGENTS.md`
  - This execution plan and its coordination-ledger row
- Out of scope:
  - Runtime code, package/app behavior, tests, and unrelated active work

## Constraints

- Technical constraints:
  - Preserve unrelated dirty work in the current checkout.
  - Keep the edit text-only and Markdown-only.
- Product/process constraints:
  - Follow repo privacy guardrails and avoid local path or direct identifier
    leakage in committed artifacts.

## Risks and mitigations

1. Risk: The new text expands `AGENTS.md` more than intended.
   Mitigation: Add one focused top section and avoid duplicating broader docs.

## Tasks

1. Read required routing and verification docs.
2. Add the top-of-file simplicity principle to `AGENTS.md`.
3. Read back the touched Markdown and run required verification.
4. Close the plan and create a scoped commit.

## Decisions

- Place the new principle directly after the `# AGENTS.md` title so it is the
  first substantive guidance in the file.

## Verification

- Commands to run:
  - `sed -n '1,80p' AGENTS.md`
  - `pnpm test:diff AGENTS.md`
  - `pnpm typecheck`
- Expected outcomes:
  - Readback shows the new top section.
  - Verification passes, or any failure is proven unrelated to this
    Markdown-only edit.
- Results:
  - Passed: `sed -n '1,90p' AGENTS.md`
  - Passed: `pnpm test:diff AGENTS.md`
  - Passed: `pnpm typecheck`
Completed: 2026-06-03
