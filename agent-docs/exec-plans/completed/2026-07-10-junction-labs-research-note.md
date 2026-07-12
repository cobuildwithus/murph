# Preserve the Junction labs research and proposal

Status: completed
Created: 2026-07-10
Updated: 2026-07-11

## Goal

- Preserve the completed Junction lab-ordering research as a durable, indexed repo note for later product and implementation planning.

## Success criteria

- The note records the proposed product shape, ownership boundaries, phased rollout, launch gates, risks, vendor questions, and consulted sources.
- The note clearly distinguishes point-in-time research from approved product behavior or an active implementation commitment.
- No copied status output, account details, local paths, or other personal identifiers enter the repository.
- The final diff remains Markdown-only and passes the docs-only verification path.

## Scope

- Add one point-in-time research note under `agent-docs/research/`.
- Add the note to `agent-docs/index.md`.
- Do not change product specs, architecture contracts, code, schema, configuration, or runtime behavior.

## Tasks

1. Convert the prior research transcript into a concise durable note.
2. Index the note and review it for scope, privacy, and unsupported approval claims.
3. Run Markdown readback and diff checks.
4. Archive this plan and create a scoped commit.

## Verification

- Read back the new note and index entry.
- Run `git diff --check`.
- Confirm the final task diff contains only Markdown files.

Result:

- Readback confirmed the proposal, launch gates, vendor questions, source list,
  and explicit point-in-time status.
- `git diff --check` passed.
- The privacy scan found no home paths, account or session text, or email
  addresses in the task files.
- The active task diff contains only Markdown files.
Completed: 2026-07-11
