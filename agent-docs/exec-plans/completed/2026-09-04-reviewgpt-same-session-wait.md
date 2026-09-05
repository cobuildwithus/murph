# Prefer Same-Session ReviewGPT Waiting

## Outcome And Scope

Keep ReviewGPT completion ownership in the original Codex session by default.
Update only workflow guidance and its index; preserve review validation,
timeouts, and finding-disposition boundaries.

## Evidence And Approach

The current AGENTS rule, workflow router, and ReviewGPT owner doc prefer
detached wake when a review outlasts the active turn and discourage session
polling. Replace that preference with same-session waiting or paced polling,
keeping detached wake available for deliberate handoffs. No runtime or tool
changes are needed.

## Steps

1. Align the three policy surfaces and index description.
2. Read back the diff, check references and stale conflicting guidance, and
   verify whitespace and privacy.
3. Archive this plan and create the scoped docs commit.

## Verification

Use the text-only Markdown verification lane: readback, reference checks, and
`git diff --check`. Tests and typecheck do not apply to this docs-only change.

## Results

- Updated AGENTS, the workflow router, the ReviewGPT owner doc, and its index
  description. Same-session capture and paced polling are preferred; detached
  wake remains an intentional handoff fallback.
- Read back the changed policy, confirmed the existing section reference, and
  searched live workflow docs and repository skills for conflicting wake rules.
- `git diff --check` passed; the diff contains no personal identifiers.
- Graft was unavailable in this environment, so discovery used scoped text
  searches. Frog inspection found no new repository-actionable friction to log.
Status: completed
Updated: 2026-09-04
Completed: 2026-09-04
