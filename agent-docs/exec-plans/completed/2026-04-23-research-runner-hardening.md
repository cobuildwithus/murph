# Research runner hardening

Status: completed
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Make the charter-first research runner fail closed on missing machine-readable seam artifacts and stop depending on inherited generic `review:gpt` packaging state.

## Success criteria

- Generated research configs are self-contained for workspace packaging and browser endpoint selection instead of sourcing the root `review-gpt` config for package resolution.
- Materialized workflows declare the required local artifact outputs for discovery and reducer seams.
- The generated `_run-review-gpt.sh` helper downloads and normalizes required artifacts after `thread wake`, then fails when required artifacts are missing locally.
- Focused orchestrator tests cover the new config shape and artifact-first completion contract.

## Scope

- In scope: `scripts/research-orchestrator/lib.mjs`, `scripts/research-materialize.mjs`, `scripts/research-init.test.ts`, the generated workspace config/helper/package-script templates those files own, and narrow README notes if needed.
- Out of scope: Health Commons content, general repo `review:gpt` defaults, and any non-research execution flow.

## Constraints

- Keep the change in the repo-internal tooling fast path if practical.
- Do not reintroduce implicit shell-state coupling through another config layer.
- Preserve existing workspaces' ability to wake/export/download threads while making new materialized seams stricter about required artifacts.

## Verification

- `pnpm typecheck`
- `pnpm exec vitest run scripts/research-init.test.ts`
- `node --check scripts/research-init.mjs`
- `node --check scripts/research-materialize.mjs`
- `git diff --check`

## Notes

- The intended hard cut is: local artifacts are the truth for research seams; prose responses are secondary logs only.
Completed: 2026-04-23
