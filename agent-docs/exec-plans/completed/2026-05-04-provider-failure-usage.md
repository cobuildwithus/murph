# Provider Failure Usage

## Goal

Persist assistant provider usage when a provider attempt fails, aborts, or returns partial output with usage metadata.

## Success Criteria

- Provider attempt failure results can carry usage and provider ids.
- Pending assistant usage records include an explicit provider request outcome: succeeded, failed, aborted, or partial.
- Existing successful usage persistence remains unchanged except for the new outcome field.
- Focused tests prove failure-path usage support.

## Constraints

- Preserve unrelated working-tree edits.
- Do not persist provider secrets, raw prompts, raw messages, transcripts, or request/response bodies.
- Keep usage accounting operational and non-canonical.

## State

- Done: Implemented failure-path usage support, provider request outcome persistence, hosted usage import/storage, focused tests, security/privacy review, coverage review, simplify review, and final review follow-up.
- Now: Safe scoped commit is blocked by overlapping active dirty work in shared assistant usage/provider files.
- Next: Archive this plan and hand off with verification evidence and blockers.

## Working Set

- `packages/assistant-engine/**`
- `packages/assistant-runtime/**`
- hosted usage import/callback tests if directly required
Status: completed
Updated: 2026-05-04
Completed: 2026-05-04
