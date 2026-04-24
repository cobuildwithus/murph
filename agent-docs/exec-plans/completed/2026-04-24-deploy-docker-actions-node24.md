# Update hosted deploy Docker actions for Node 24

Status: completed
Created: 2026-04-24
Updated: 2026-04-24

## Goal

- Update the hosted execution production deploy workflow so Docker JavaScript actions use Node 24-compatible major versions.

## Success criteria

- `.github/workflows/deploy-cloudflare-hosted.yml` no longer references `docker/setup-buildx-action@v3` or `docker/build-push-action@v6`.
- The directly coupled deploy workflow assertion in `apps/cloudflare/test/deploy-automation.test.ts` matches the workflow.
- Focused verification passes or any unrelated blocker is named exactly.

## Scope

- In scope:
  - `.github/workflows/deploy-cloudflare-hosted.yml`
  - `apps/cloudflare/test/deploy-automation.test.ts`
- Out of scope:
  - Deploying the workflow.
  - Changing Docker build inputs, runner image tags, cache scopes, or Cloudflare deploy semantics.

## Constraints

- Preserve unrelated dirty work.
- Use official Docker action releases for version selection.
- Do not add temporary Node 24 force/opt-out env vars when compatible major actions are available.

## Tasks

1. Confirm current Docker action versions and Node 24 support from official sources.
2. Bump the workflow action references.
3. Update the coupled test expectation.
4. Run focused verification, typecheck baseline as required, final review, and scoped commit.

## Decisions

- Use `docker/setup-buildx-action@v4` and `docker/build-push-action@v7`; their `action.yml` metadata declares `runs.using: node24`.

## Verification

- Commands to run:
  - focused deploy automation Vitest test
  - `pnpm --dir apps/cloudflare typecheck`
  - `pnpm typecheck`
  - `git diff --check`
Completed: 2026-04-24
