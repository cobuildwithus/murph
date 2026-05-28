# Assistant Skill File Extraction

## Goal

Move the long experiment-onboarding assistant workflow out of the stable system prompt and into a package-owned Murph skill file, with the prompt retaining only a compact route hint that references `$MURPH_ASSISTANT_SKILLS_ROOT/experiment-onboarding/SKILL.md`.

## Scope

- Add a generic assistant skill registry in `packages/assistant-engine`.
- Add the package-owned `experiment-onboarding` skill asset.
- Replace the long system-prompt onboarding body with generic registry-rendered route hints.
- Expose `MURPH_ASSISTANT_SKILLS_ROOT` to local Codex turns and hosted shell commands.
- Preserve hosted native Codex skill instructions as disabled.
- Update tests for prompt stability, skill assets, package publishing, local env, and hosted config.

## Non-Goals

- No per-skill environment variables.
- No native hosted Codex skill rendering.
- No user-vault or restored-workspace skill roots.
- No new generic prompt framework beyond the one registry renderer.

## Verification

- `pnpm --filter @murphai/assistant-engine test`
- `pnpm --filter @murphai/assistant-runtime test`
- `pnpm --filter @murphai/assistant-engine build`
- `pnpm --filter @murphai/assistant-runtime build`
- Direct prompt/config readback for stable skill-root references and absence of long onboarding body/path leakage.
