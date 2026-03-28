# Execution Plan: Hosted Surface Hardening

## Goal

Land the hosted data-leak hardening fixes for the web control plane, hosted execution runner, and shared hosted-execution helpers without widening into unrelated product changes.

## Scope

- Tighten hosted/control callback base URL normalization and rejection rules.
- Enforce explicit browser `Origin` checks on sensitive cookie-authenticated hosted mutation routes.
- Reduce public invite/share metadata exposure and keep share-token boundaries strict.
- Narrow user-configurable hosted env passthrough to the minimum intended runner surface.
- Add focused regression coverage for the hardened behaviors.

## Constraints

- Preserve existing hosted execution behavior where possible unless it widens blast radius.
- Do not expose secrets, tokens, or local identifiers in diffs, logs, or commit metadata.
- Preserve adjacent in-flight hosted/device-sync/onboarding edits in the worktree.
- Run required repo verification plus mandatory completion-workflow audit passes before handoff.

## Notes

- The supplied patch is treated as audit guidance, not a line-for-line patch application target.
- The prompt-injection egress risk is partly architectural; code changes here should reduce practical exposure and fail closed where the current design permits.
Status: completed
Updated: 2026-03-29
Completed: 2026-03-29
