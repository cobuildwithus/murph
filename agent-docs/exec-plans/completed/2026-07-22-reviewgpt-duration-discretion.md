# ReviewGPT Duration Discretion

## Outcome

Make ReviewGPT timing a calibrated trust signal: final-review responses close
to the 7.5-minute floor may count after explicit local judgment, while the
narrower preliminary specialist pass uses a lower minimum appropriate to its
scoped lenses.

## Scope

- Update the canonical ReviewGPT completion-loop policy only.
- Keep exact-turn, attachment, completion-marker, model, and artifact-quality
  checks mandatory.
- Preserve fail-closed handling for clearly implausible fast responses.
- Explain how to handle the package's conservative too-fast diagnostic when a
  response qualifies for the documented manual exception.

## Verification

- Read back the changed policy in context.
- Run `git diff --check`.
- Run the docs-only verification route from
  `agent-docs/operations/verification-and-runtime.md`.

Status: completed
Updated: 2026-07-22
Completed: 2026-07-22
