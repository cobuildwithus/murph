# Assistant Skill Hardening

## Goal

Tighten the assistant skill-file extraction follow-up so the registry, route hint, skill asset text, local root env behavior, and hosted readability tests stay simple and composable as more Murph-managed skills are added.

## Scope

- Clarify the experiment-onboarding skill text for lab follow-up measurements.
- Make the skill route hint support the minimal matching skill file set.
- Add registry slug/name safety checks and frontmatter description length coverage.
- Expose local turns to the canonical package-owned skills root without preserving stale overrides.
- Add hosted runtime coverage that the configured skill root can read the registered skill file.

## Non-Goals

- No new skill-specific prompt functions or env vars.
- No native hosted Codex skill rendering.
- No broader prompt architecture changes.

## Verification

- `pnpm --filter @murphai/assistant-engine test`
- `pnpm --filter @murphai/assistant-runtime test`
- `pnpm --filter @murphai/assistant-engine build`
- `pnpm --filter @murphai/assistant-runtime build`
- `pnpm typecheck`

Status: completed
Updated: 2026-05-28
Completed: 2026-05-28
