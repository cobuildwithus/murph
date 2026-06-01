# Invariants Primitives And Logging

## Goal

Add baseline invariants that make two architecture preferences explicit:

- Prefer simple, composable primitives over complex abstractions.
- For observability, log errors at the root failure boundary with shared secret redaction instead of scattering patchwork logs.

Success criteria:

- `docs/contracts/00-invariants.md` states the primitive preference clearly.
- `docs/contracts/00-invariants.md` adds the logging invariant without weakening privacy or secret-handling rules.
- The touched doc is read back and the required narrow checks pass or any blockers are recorded.

## Constraints

- Documentation-only change.
- Do not touch runtime code or logging helpers.
- Do not expose secrets, local paths, direct identifiers, or raw credentials.
- Preserve unrelated dirty working-tree changes.

## Plan

1. Add the invariant text in the most relevant existing sections.
2. Read back the edited doc and inspect the diff.
3. Run the docs/text fast-path checks required for this change.
4. Close the plan through `scripts/finish-task` if the scoped commit is safe.
Status: completed
Updated: 2026-06-01
Completed: 2026-06-01
