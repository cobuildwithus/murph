# Get Release Check Passing

## Goal

Get `pnpm release:check` passing on the current branch after removing the abandoned hosted-onboarding identity-merge patch.

## Why

- `release:check` is the repo’s release gate and currently cannot be trusted until it runs clean on this branch.
- The previous dirty hosted-onboarding identity-merge work is no longer wanted and should not keep poisoning the release lane.

## Scope

- Root release and verification scripts only as needed
- Any directly failing code or test files surfaced by `pnpm release:check`
- Coordination cleanup for the abandoned identity-merge lane

## Guardrails

- Do not revive the removed identity-merge behavior.
- Preserve unrelated in-progress work, especially the active hosted Linq debug lane.
- Keep fixes proportional to the actual release blockers reported by the gate.

## Verification target

- `pnpm release:check`
Status: completed
Updated: 2026-04-16
Completed: 2026-04-16
